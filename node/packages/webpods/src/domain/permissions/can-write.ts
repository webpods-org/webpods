/**
 * Check if a user can write to a stream
 */

import { DataContext } from "../data-context.js";
import { Stream } from "../../types.js";
import { parsePermission } from "./parse-permission.js";
import { checkPermissionStream } from "./check-permission-stream.js";
import { createLogger } from "../../logger.js";
import { createSchema } from "@webpods/tinqer";
import { executeSelect } from "@webpods/tinqer-sql-pg-promise";
import type { DatabaseSchema } from "../../db/schema.js";

const logger = createLogger("webpods:domain:permissions");
const schema = createSchema<DatabaseSchema>();

/**
 * Check permissions for a specific stream (internal helper)
 */
async function checkStreamPermission(
  ctx: DataContext,
  stream: Stream,
  userId: string,
  podOwner: string | null,
): Promise<boolean | null> {
  // If user is the pod owner, they have full access
  if (podOwner && userId === podOwner) {
    return true;
  }

  // Creator has access (only if they're still the pod owner or no owner is set)
  if (userId === stream.userId) {
    if (!podOwner || podOwner === userId) {
      return true;
    }
    // Creator lost access after ownership transfer
    return false;
  }

  // Public write access - authenticated users can write
  if (stream.accessPermission === "public") {
    return true;
  }

  // Private access - only creator
  if (stream.accessPermission === "private") {
    return userId === stream.userId;
  }

  // Parse permission
  const perm = parsePermission(stream.accessPermission);

  if (perm.type === "stream" && perm.streamPath) {
    // Check if user has write permission in the permission stream
    const result = await checkPermissionStream(
      ctx,
      stream.podName,
      perm.streamPath,
      userId,
      "write",
    );
    return result;
  }

  // No explicit permission found for this stream
  return null;
}

export async function canWrite(
  ctx: DataContext,
  stream: Stream,
  userId: string,
): Promise<boolean> {
  logger.info("canWrite check", {
    streamId: stream.name,
    accessPermission: stream.accessPermission,
    userId,
    creatorId: stream.userId,
  });

  // First get pod owner using separate queries
  let podOwner: string | null = null;

  // Get .config stream
  const configStreamResults = await executeSelect(
    ctx.db,
    schema,
    (q, p) =>
      q
        .from("stream")
        .where(
          (s) =>
            s.pod_name === p.pod_name &&
            s.name === ".config" &&
            s.parent_id === null,
        )
        .select((s) => ({ id: s.id })),
    { pod_name: stream.podName },
  );

  const configStream = configStreamResults[0] || null;

  if (configStream) {
    // Get owner stream (child of .config)
    const ownerStreamResults = await executeSelect(
      ctx.db,
      schema,
      (q, p) =>
        q
          .from("stream")
          .where((s) => s.parent_id === p.parent_id && s.name === "owner")
          .select((s) => ({ id: s.id })),
      { parent_id: configStream.id },
    );

    const ownerStream = ownerStreamResults[0] || null;

    if (ownerStream) {
      // Get owner record
      const ownerRecordResults = await executeSelect(
        ctx.db,
        schema,
        (q, p) =>
          q
            .from("record")
            .where((r) => r.stream_id === p.stream_id && r.name === "owner")
            .orderByDescending((r) => r.index)
            .take(1),
        { stream_id: ownerStream.id },
      );

      const ownerRecord = ownerRecordResults[0] || null;

      if (ownerRecord) {
        try {
          const content = JSON.parse(ownerRecord.content);
          podOwner = content.userId || null;
        } catch {
          // If we can't parse owner record, podOwner remains null
        }
      }
    }
  }

  // Check current stream permissions
  const currentPermission = await checkStreamPermission(
    ctx,
    stream,
    userId,
    podOwner,
  );
  if (currentPermission !== null) {
    return currentPermission;
  }

  // If no explicit permission on current stream, check parent streams
  let currentStreamId = stream.parentId;
  while (currentStreamId) {
    const parentStreamResults = await executeSelect(
      ctx.db,
      schema,
      (q, p) => q.from("stream").where((s) => s.id === p.id),
      { id: currentStreamId },
    );

    const parentStream = parentStreamResults[0] || null;

    if (!parentStream) {
      break;
    }

    // Map to Stream type
    const parentStreamObj: Stream = {
      id: parentStream.id,
      podName: parentStream.pod_name,
      name: parentStream.name,
      path: parentStream.path,
      parentId: parentStream.parent_id || null,
      userId: parentStream.user_id,
      accessPermission: parentStream.access_permission,
      metadata: JSON.parse(parentStream.metadata),
      hasSchema: parentStream.has_schema,
      createdAt: parentStream.created_at,
      updatedAt: parentStream.updated_at,
    };

    const parentPermission = await checkStreamPermission(
      ctx,
      parentStreamObj,
      userId,
      podOwner,
    );
    if (parentPermission !== null) {
      logger.info("Permission inherited from parent stream", {
        streamId: stream.id,
        parentId: currentStreamId,
        permission: parentPermission,
      });
      return parentPermission;
    }

    currentStreamId = parentStream.parent_id || null;
  }

  // No permission found in hierarchy, default to deny
  return false;
}
