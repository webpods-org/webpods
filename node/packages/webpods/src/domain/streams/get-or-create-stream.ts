/**
 * Get a stream (no longer creates)
 * @deprecated Use getStream() instead
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { StreamDbRow } from "../../db-types.js";
import { Stream } from "../../types.js";
import { isValidStreamId } from "../../utils.js";
import { createLogger } from "../../logger.js";
import { updateStreamPermissions } from "./update-stream-permissions.js";
import { createError } from "../../utils/errors.js";

const logger = createLogger("webpods:domain:streams");

/**
 * Map database row to domain type
 */
function mapStreamFromDb(row: StreamDbRow): Stream {
  return {
    podName: row.pod_name,
    name: row.name,
    userId: row.user_id,
    accessPermission: row.access_permission,
    streamType: row.stream_type,
    metadata: row.metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at,
  };
}

export async function getOrCreateStream(
  ctx: DataContext,
  podName: string,
  streamId: string,
  userId: string,
  accessPermission?: string,
): Promise<Result<{ stream: Stream; created: boolean; updated?: boolean }>> {
  // NO LONGER CREATES STREAMS - just gets existing ones
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
         AND name = $(name)`,
      { pod_name: podName, name: actualStreamId },
    );

    if (stream) {
      // Check if permissions need to be updated
      if (accessPermission && accessPermission !== stream.access_permission) {
        // Only the creator can update permissions
        if (stream.user_id !== userId) {
          logger.warn("Non-creator attempted to update stream permissions", {
            podName: stream.pod_name,
            streamId: stream.name,
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
          stream.name,
          accessPermission,
        );

        if (!updateResult.success) {
          logger.error("Failed to update stream permissions", {
            podName: stream.pod_name,
            streamId: stream.name,
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
             AND name = $(name)`,
          { pod_name: stream.pod_name, name: stream.name },
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

    // Stream doesn't exist - no longer auto-create
    return failure(
      createError(
        "STREAM_NOT_FOUND",
        `Stream '${actualStreamId}' does not exist. Streams must be created explicitly.`,
      ),
    );
  } catch (error: unknown) {
    logger.error("Failed to get or create stream", {
      error,
      podName,
      streamId,
    });
    return failure(new Error("Failed to get or create stream"));
  }
}
