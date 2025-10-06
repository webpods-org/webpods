/**
 * Create a stream explicitly
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { StreamDbRow } from "../../db-types.js";
import { Stream } from "../../types.js";
import { createLogger } from "../../logger.js";
import { createError } from "../../utils/errors.js";
import { isValidStreamName } from "../../utils/stream-utils.js";
import { getCache, cacheKeys } from "../../cache/index.js";
import { createSchema } from "@webpods/tinqer";
import { executeSelect, executeInsert } from "@webpods/tinqer-sql-pg-promise";
import type { DatabaseSchema } from "../../db/schema.js";

const logger = createLogger("webpods:domain:streams");
const schema = createSchema<DatabaseSchema>();

/**
 * Map database row to domain type
 */
export function mapStreamFromDb(row: StreamDbRow): Stream {
  return {
    id: row.id,
    podName: row.pod_name,
    name: row.name,
    path: row.path,
    parentId: row.parent_id || null,
    userId: row.user_id,
    accessPermission: row.access_permission,
    metadata: JSON.parse(row.metadata),
    hasSchema: row.has_schema,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createStream(
  ctx: DataContext,
  podName: string,
  streamName: string,
  userId: string,
  parentId: number | null = null,
  accessPermission: string = "public",
): Promise<Result<Stream>> {
  // Validate stream name (no slashes allowed)
  if (!isValidStreamName(streamName)) {
    return failure(
      createError(
        "INVALID_STREAM_NAME",
        "Invalid stream name - cannot contain slashes",
      ),
    );
  }

  try {
    // Check if stream already exists with same name in same parent
    const existingStreams = await executeSelect(
      ctx.db,
      schema,
      (q, p) =>
        q
          .from("stream")
          .where(
            (s) =>
              s.pod_name === p.podName &&
              s.name === p.name &&
              s.parent_id === p.parentId,
          ),
      { podName, name: streamName, parentId },
    );

    const existingStream = existingStreams[0] || null;

    if (existingStream) {
      return failure(
        createError("STREAM_EXISTS", `Stream '${streamName}' already exists`),
      );
    }

    // Check if a record with the same name exists in the parent stream
    if (parentId) {
      const existingRecords = await executeSelect(
        ctx.db,
        schema,
        (q, p) =>
          q
            .from("record")
            .where((r) => r.stream_id === p.parentId && r.name === p.name)
            .take(1),
        { parentId, name: streamName },
      );

      const existingRecord = existingRecords[0] || null;

      if (existingRecord) {
        return failure(
          createError(
            "NAME_CONFLICT",
            `A record named '${streamName}' already exists in the parent stream`,
          ),
        );
      }
    }

    // Check if user is the pod owner
    // First find the .config/owner stream
    const ownerStream = await ctx.db.oneOrNone<StreamDbRow>(
      `SELECT * FROM stream
       WHERE pod_name = $(podName)
         AND name = 'owner'
         AND parent_id IN (
           SELECT id FROM stream 
           WHERE pod_name = $(podName) 
           AND name = '.config' 
           AND parent_id IS NULL
         )`,
      { podName },
    );

    if (ownerStream) {
      const ownerRecords = await executeSelect(
        ctx.db,
        schema,
        (q, p) =>
          q
            .from("record")
            .where((r) => r.stream_id === p.streamId && r.name === "owner")
            .orderByDescending((r) => r.index)
            .take(1),
        { streamId: ownerStream.id },
      );

      const ownerRecord = ownerRecords[0] || null;

      if (ownerRecord) {
        try {
          const content = JSON.parse(ownerRecord.content);
          const podOwner = content.userId;

          // Only the pod owner can create new streams
          if (podOwner !== userId) {
            logger.warn("Non-owner attempted to create stream", {
              podName,
              streamName,
              userId,
              ownerId: podOwner,
            });
            return failure(
              createError(
                "FORBIDDEN",
                "Only the pod owner can create new streams",
              ),
            );
          }
        } catch {
          logger.warn("Failed to parse owner record", { podName });
        }
      }
    }

    // Compute the full path
    let fullPath: string;
    if (parentId) {
      // Get parent path to build full path
      const parentStreams = await executeSelect(
        ctx.db,
        schema,
        (q, p) =>
          q
            .from("stream")
            .where((s) => s.id === p.parentId)
            .select((s) => ({ path: s.path })),
        { parentId },
      );

      const parentStream = parentStreams[0] || null;

      if (!parentStream) {
        return failure(
          createError("PARENT_NOT_FOUND", "Parent stream not found"),
        );
      }
      fullPath = `${parentStream.path}/${streamName}`;
    } else {
      // Root-level stream
      fullPath = streamName;
    }

    // Create new stream with path
    const now = Date.now();
    const streams = await executeInsert(
      ctx.db,
      schema,
      (q, p) =>
        q
          .insertInto("stream")
          .values({
            pod_name: p.podName,
            name: p.name,
            path: p.path,
            parent_id: p.parentId,
            user_id: p.userId,
            access_permission: p.accessPermission,
            has_schema: p.hasSchema,
            metadata: p.metadata,
            created_at: p.createdAt,
            updated_at: p.updatedAt,
          })
          .returning((s) => s),
      {
        podName,
        name: streamName,
        path: fullPath,
        parentId,
        userId,
        accessPermission,
        hasSchema: false,
        metadata: JSON.stringify({}),
        createdAt: now,
        updatedAt: now,
      },
    );

    const stream = streams[0];
    if (!stream) {
      return failure(createError("CREATE_ERROR", "Failed to create stream"));
    }

    logger.info("Stream created", {
      podName: stream.pod_name,
      streamName: stream.name,
      userId,
    });

    // Invalidate caches
    const cache = getCache();
    if (cache) {
      // Invalidate ALL pod stream list caches (for /.config/api/streams endpoint)
      // This ensures no stale cache remains regardless of query options
      await cache.deletePattern(
        "streams",
        cacheKeys.podStreamsPattern(podName),
      );

      // Invalidate parent's child stream list cache if applicable
      if (parentId) {
        await cache.delete(
          "streams",
          cacheKeys.streamChildren(podName, parentId),
        );
        await cache.delete(
          "streams",
          cacheKeys.streamChildrenCount(podName, parentId),
        );
      }

      // Also invalidate root-level cache if this is a root stream
      if (!parentId) {
        await cache.delete("streams", cacheKeys.streamChildren(podName, null));
        await cache.delete(
          "streams",
          cacheKeys.streamChildrenCount(podName, null),
        );
      }
    }

    return success(mapStreamFromDb(stream));
  } catch (error: unknown) {
    logger.error("Failed to create stream", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      podName,
      streamName,
    });
    return failure(
      createError(
        "CREATE_ERROR",
        (error as Error).message || "Failed to create stream",
      ),
    );
  }
}
