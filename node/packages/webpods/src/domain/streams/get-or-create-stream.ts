/**
 * Get or create a stream
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { StreamDbRow } from "../../db-types.js";
import { Stream } from "../../types.js";
import { isValidStreamId } from "../../utils.js";
import { createLogger } from "../../logger.js";
import { sql } from "../../db/index.js";
import { updateStreamPermissions } from "./update-stream-permissions.js";

const logger = createLogger("webpods:domain:streams");

/**
 * Map database row to domain type
 */
function mapStreamFromDb(row: StreamDbRow): Stream {
  return {
    pod_name: row.pod_name,
    stream_id: row.stream_id,
    user_id: row.user_id,
    access_permission: row.access_permission,
    metadata: row.metadata,
    created_at: row.created_at,
    updated_at: row.updated_at || row.created_at,
  };
}

export async function getOrCreateStream(
  ctx: DataContext,
  podName: string,
  streamId: string,
  userId: string,
  accessPermission?: string,
): Promise<Result<{ stream: Stream; created: boolean; updated?: boolean }>> {
  // Validate stream ID
  if (!isValidStreamId(streamId)) {
    return failure(new Error("Invalid stream ID"));
  }

  const actualStreamId = streamId;

  try {
    // Try to find existing stream
    let stream = await ctx.db.oneOrNone<StreamDbRow>(
      `SELECT * FROM stream 
       WHERE pod_name = $(pod_name) 
         AND stream_id = $(stream_id)`,
      { pod_name: podName, stream_id: actualStreamId },
    );

    if (stream) {
      // Check if permissions need to be updated
      if (accessPermission && accessPermission !== stream.access_permission) {
        // Only the creator can update permissions
        if (stream.user_id !== userId) {
          logger.warn("Non-creator attempted to update stream permissions", {
            podName: stream.pod_name,
            streamId: stream.stream_id,
            userId,
            creatorId: stream.user_id,
          });
          // Return the existing stream without updating
          return success({
            stream: mapStreamFromDb(stream),
            created: false,
            updated: false,
          });
        }

        // Update the stream permissions
        const updateResult = await updateStreamPermissions(
          ctx,
          stream.pod_name,
          stream.stream_id,
          accessPermission,
        );

        if (!updateResult.success) {
          logger.error("Failed to update stream permissions", {
            podName: stream.pod_name,
            streamId: stream.stream_id,
            error: updateResult.error,
          });
          // Return the existing stream even if update fails
          return success({
            stream: mapStreamFromDb(stream),
            created: false,
            updated: false,
          });
        }

        // Fetch the updated stream
        stream = await ctx.db.one<StreamDbRow>(
          `SELECT * FROM stream 
           WHERE pod_name = $(pod_name) 
             AND stream_id = $(stream_id)`,
          { pod_name: stream.pod_name, stream_id: stream.stream_id },
        );

        return success({
          stream: mapStreamFromDb(stream),
          created: false,
          updated: true,
        });
      }

      return success({
        stream: mapStreamFromDb(stream),
        created: false,
      });
    }

    // Create new stream with snake_case parameters
    const params = {
      pod_name: podName,
      stream_id: actualStreamId,
      user_id: userId,
      access_permission: accessPermission || "public",
      created_at: new Date(),
    };

    stream = await ctx.db.one<StreamDbRow>(
      `${sql.insert("stream", params)} RETURNING *`,
      params,
    );

    logger.info("Stream created", {
      podName: stream.pod_name,
      streamId: stream.stream_id,
      userId,
    });

    return success({
      stream: mapStreamFromDb(stream),
      created: true,
    });
  } catch (error: any) {
    logger.error("Failed to get or create stream", {
      error,
      podName,
      streamId,
    });
    return failure(new Error("Failed to get or create stream"));
  }
}
