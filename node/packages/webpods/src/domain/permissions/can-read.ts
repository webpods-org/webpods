/**
 * Check if a user can read from a stream
 */

import { DataContext } from "../data-context.js";
import { Stream } from "../../types.js";
import { RecordDbRow, StreamDbRow } from "../../db-types.js";
import { createLogger } from "../../logger.js";
import { parsePermission } from "./parse-permission.js";
import { checkPermissionStream } from "./check-permission-stream.js";

const logger = createLogger("webpods:domain:permissions");

/**
 * Check permissions for a specific stream (internal helper)
 */
async function checkStreamPermission(
  ctx: DataContext,
  stream: Stream,
  userId: string | null,
  podOwner: string | null,
): Promise<boolean | null> {
  // If user is the pod owner, they have full access
  if (podOwner && userId === podOwner) {
    return true;
  }

  // Creator has access (only if they're still the pod owner or no owner is set)
  if (userId && userId === stream.userId) {
    if (!podOwner || podOwner === userId) {
      return true;
    }
  }

  // Public read access - anyone can read
  if (stream.accessPermission === "public") {
    return true;
  }

  // Private access - only creator
  if (stream.accessPermission === "private") {
    return userId === stream.userId;
  }

  // No auth means no access for non-public
  if (!userId) {
    return false;
  }

  // Parse permission
  const perm = parsePermission(stream.accessPermission);

  if (perm.type === "stream" && perm.streamPath) {
    // Check if user has read permission in the permission stream
    const result = await checkPermissionStream(
      ctx,
      stream.podName,
      perm.streamPath,
      userId,
      "read",
    );
    return result;
  }

  // No explicit permission found for this stream
  return null;
}

export async function canRead(
  ctx: DataContext,
  stream: Stream,
  userId: string | null,
): Promise<boolean> {
  logger.info("canRead check", {
    streamId: stream.name,
    accessPermission: stream.accessPermission,
    userId,
    creatorId: stream.userId,
  });

  // First get pod owner using separate queries
  let podOwner: string | null = null;

  // Get .config stream
  const configStream = await ctx.db.oneOrNone<StreamDbRow>(
    `SELECT id FROM stream 
     WHERE pod_name = $(pod_name) 
       AND name = '.config' 
       AND parent_id IS NULL`,
    { pod_name: stream.podName },
  );

  if (configStream) {
    // Get owner stream (child of .config)
    const ownerStream = await ctx.db.oneOrNone<StreamDbRow>(
      `SELECT id FROM stream 
       WHERE parent_id = $(parent_id) 
         AND name = 'owner'`,
      { parent_id: configStream.id },
    );

    if (ownerStream) {
      // Get owner record
      const ownerRecord = await ctx.db.oneOrNone<RecordDbRow>(
        `SELECT * FROM record 
         WHERE stream_id = $(stream_id)
           AND name = 'owner'
         ORDER BY index DESC
         LIMIT 1`,
        { stream_id: ownerStream.id },
      );

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
    const parentStream = await ctx.db.oneOrNone<StreamDbRow>(
      `SELECT * FROM stream WHERE id = $(id)`,
      { id: currentStreamId },
    );

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
      metadata: parentStream.metadata,
      createdAt: parentStream.created_at,
      updatedAt: parentStream.updated_at || parentStream.created_at,
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
