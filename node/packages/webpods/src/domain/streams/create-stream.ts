/**
 * Create a stream explicitly
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { StreamDbRow, RecordDbRow } from "../../db-types.js";
import { Stream } from "../../types.js";
import { createLogger } from "../../logger.js";
import { createError } from "../../utils/errors.js";
import { isValidStreamName } from "../../utils/stream-utils.js";

const logger = createLogger("webpods:domain:streams");

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
    metadata: row.metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at,
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
    const existingStream = await ctx.db.oneOrNone<StreamDbRow>(
      `SELECT * FROM stream 
       WHERE pod_name = $(podName) 
         AND name = $(name)
         AND (parent_id = $(parentId) OR (parent_id IS NULL AND $(parentId)::bigint IS NULL))`,
      { podName, name: streamName, parentId },
    );

    if (existingStream) {
      return failure(
        createError("STREAM_EXISTS", `Stream '${streamName}' already exists`),
      );
    }

    // Check if a record with the same name exists in the parent stream
    if (parentId) {
      const existingRecord = await ctx.db.oneOrNone<RecordDbRow>(
        `SELECT * FROM record 
         WHERE stream_id = $(parentId) 
           AND name = $(name)
         LIMIT 1`,
        { parentId, name: streamName },
      );

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
      const ownerRecord = await ctx.db.oneOrNone<RecordDbRow>(
        `SELECT * FROM record
         WHERE stream_id = $(streamId)
           AND name = 'owner'
         ORDER BY index DESC
         LIMIT 1`,
        { streamId: ownerStream.id },
      );

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
      const parentStream = await ctx.db.oneOrNone<StreamDbRow>(
        `SELECT path FROM stream WHERE id = $(parentId)`,
        { parentId },
      );
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
    const stream = await ctx.db.one<StreamDbRow>(
      `INSERT INTO stream (pod_name, name, path, parent_id, user_id, access_permission)
       VALUES ($(podName), $(name), $(path), $(parentId), $(userId), $(accessPermission))
       RETURNING *`,
      {
        podName,
        name: streamName,
        path: fullPath,
        parentId,
        userId,
        accessPermission,
      },
    );

    logger.info("Stream created", {
      podName: stream.pod_name,
      streamName: stream.name,
      userId,
    });

    return success(mapStreamFromDb(stream));
  } catch (error: unknown) {
    logger.error("Failed to create stream", {
      error,
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
