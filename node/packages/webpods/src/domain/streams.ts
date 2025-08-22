/**
 * Stream operations domain logic
 */

import { Database } from "../db.js";
import { StreamDbRow } from "../db-types.js";
import { Stream, Result } from "../types.js";
import { isValidStreamId, isSystemStream } from "../utils.js";
import { createLogger } from "../logger.js";

const logger = createLogger("webpods:domain:streams");

/**
 * Map database row to domain type
 */
function mapStreamFromDb(row: StreamDbRow): Stream {
  return {
    id: row.id,
    pod_id: row.pod_id,
    stream_id: row.stream_id,
    creator_id: row.creator_id,
    access_permission: row.access_permission,
    metadata: undefined,
    created_at: row.created_at,
    updated_at: row.created_at,
  };
}

/**
 * Get or create a stream
 */
export async function getOrCreateStream(
  db: Database,
  podId: string,
  streamId: string,
  userId: string,
  accessPermission?: string,
): Promise<Result<{ stream: Stream; created: boolean; updated?: boolean }>> {
  // Validate stream ID
  if (!isValidStreamId(streamId)) {
    return {
      success: false,
      error: {
        code: "INVALID_STREAM_ID",
        message: "Invalid stream ID",
      },
    };
  }

  const actualStreamId = streamId;

  try {
    // Try to find existing stream
    let stream = await db.oneOrNone<StreamDbRow>(
      `SELECT * FROM stream 
       WHERE pod_id = $(podId) 
         AND stream_id = $(streamId)`,
      { podId, streamId: actualStreamId },
    );

    if (stream) {
      // Check if permissions need to be updated
      if (accessPermission && accessPermission !== stream.access_permission) {
        // Only the creator can update permissions
        if (stream.creator_id !== userId) {
          logger.warn("Non-creator attempted to update stream permissions", {
            streamId: stream.id,
            userId,
            creatorId: stream.creator_id,
          });
          // Return the existing stream without updating
          return {
            success: true,
            data: {
              stream: mapStreamFromDb(stream),
              created: false,
              updated: false,
            },
          };
        }

        // Update the stream permissions
        const updateResult = await updateStreamPermissions(
          db,
          stream.id,
          accessPermission,
        );

        if (!updateResult.success) {
          logger.error("Failed to update stream permissions", {
            streamId: stream.id,
            error: updateResult.error,
          });
          // Return the existing stream even if update fails
          return {
            success: true,
            data: {
              stream: mapStreamFromDb(stream),
              created: false,
              updated: false,
            },
          };
        }

        logger.info("Stream permissions updated", {
          streamId: stream.id,
          oldPermission: stream.access_permission,
          newPermission: accessPermission,
          userId,
        });

        return {
          success: true,
          data: { stream: updateResult.data, created: false, updated: true },
        };
      }

      return {
        success: true,
        data: {
          stream: mapStreamFromDb(stream),
          created: false,
          updated: false,
        },
      };
    }

    // Create new stream
    stream = await db.one<StreamDbRow>(
      `INSERT INTO stream (id, pod_id, stream_id, creator_id, access_permission, created_at)
       VALUES (gen_random_uuid(), $(podId), $(streamId), $(userId), $(accessPermission), NOW())
       RETURNING *`,
      {
        podId,
        streamId: actualStreamId,
        userId,
        accessPermission: accessPermission || "public",
      },
    );

    logger.info("Stream created", { podId, streamId: actualStreamId, userId });
    return {
      success: true,
      data: { stream: mapStreamFromDb(stream), created: true },
    };
  } catch (error: any) {
    logger.error("Failed to get/create stream", { error, podId, streamId });
    return {
      success: false,
      error: {
        code: "DATABASE_ERROR",
        message: "Failed to get/create stream",
      },
    };
  }
}

/**
 * Get stream by pod and stream ID
 */
export async function getStream(
  db: Database,
  podId: string,
  streamId: string,
): Promise<Result<Stream>> {
  try {
    const stream = await db.oneOrNone<StreamDbRow>(
      `SELECT * FROM stream 
       WHERE pod_id = $(podId) 
         AND stream_id = $(streamId)`,
      { podId, streamId },
    );

    if (!stream) {
      return {
        success: false,
        error: {
          code: "STREAM_NOT_FOUND",
          message: "Stream not found",
        },
      };
    }

    return { success: true, data: mapStreamFromDb(stream) };
  } catch (error: any) {
    logger.error("Failed to get stream", { error, podId, streamId });
    return {
      success: false,
      error: {
        code: "DATABASE_ERROR",
        message: "Failed to get stream",
      },
    };
  }
}

/**
 * Delete a stream
 */
export async function deleteStream(
  db: Database,
  podId: string,
  streamId: string,
  userId: string,
): Promise<Result<void>> {
  // Prevent deletion of system streams
  if (isSystemStream(streamId)) {
    return {
      success: false,
      error: {
        code: "FORBIDDEN",
        message: "System streams cannot be deleted",
      },
    };
  }

  try {
    const stream = await db.oneOrNone<StreamDbRow>(
      `SELECT * FROM stream 
       WHERE pod_id = $(podId) 
         AND stream_id = $(streamId)`,
      { podId, streamId },
    );

    if (!stream) {
      return {
        success: false,
        error: {
          code: "STREAM_NOT_FOUND",
          message: "Stream not found",
        },
      };
    }

    // Only creator can delete stream
    if (stream.creator_id !== userId) {
      return {
        success: false,
        error: {
          code: "FORBIDDEN",
          message: "Only stream creator can delete stream",
        },
      };
    }

    // Delete stream (cascades to records)
    await db.none(`DELETE FROM stream WHERE id = $(streamId)`, {
      streamId: stream.id,
    });

    logger.info("Stream deleted", { podId, streamId, userId });
    return { success: true, data: undefined };
  } catch (error: any) {
    logger.error("Failed to delete stream", { error, podId, streamId });
    return {
      success: false,
      error: {
        code: "DATABASE_ERROR",
        message: "Failed to delete stream",
      },
    };
  }
}

/**
 * Update stream permissions
 */
export async function updateStreamPermissions(
  db: Database,
  streamId: string,
  accessPermission?: string,
): Promise<Result<Stream>> {
  try {
    const stream = await db.oneOrNone<StreamDbRow>(
      `UPDATE stream 
       SET access_permission = COALESCE($(accessPermission), access_permission)
       WHERE id = $(streamId)
       RETURNING *`,
      { streamId, accessPermission },
    );

    if (!stream) {
      return {
        success: false,
        error: {
          code: "STREAM_NOT_FOUND",
          message: "Stream not found",
        },
      };
    }

    return { success: true, data: mapStreamFromDb(stream) };
  } catch (error: any) {
    logger.error("Failed to update stream permissions", { error, streamId });
    return {
      success: false,
      error: {
        code: "DATABASE_ERROR",
        message: "Failed to update stream permissions",
      },
    };
  }
}
