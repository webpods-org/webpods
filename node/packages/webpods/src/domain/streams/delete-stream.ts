/**
 * Delete a stream and all its records
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { createError } from "../../utils/errors.js";
import { StreamDbRow } from "../../db-types.js";
import { createLogger } from "../../logger.js";

const logger = createLogger("webpods:domain:streams");

export async function deleteStream(
  ctx: DataContext,
  podName: string,
  streamId: number,
  userId: string,
): Promise<Result<void>> {
  // Cannot delete system streams
  // TODO: Update isSystemStream to work with IDs
  // For now, skip this check since we're using stream IDs

  try {
    return await ctx.db.tx(async (t) => {
      // Get the stream by ID
      const stream = await t.oneOrNone<StreamDbRow>(
        `SELECT * FROM stream
         WHERE id = $(streamId)
           AND pod_name = $(pod_name)`,
        { streamId, pod_name: podName },
      );

      if (!stream) {
        return failure(createError("NOT_FOUND", "Stream not found"));
      }

      // Only the creator can delete a stream
      if (stream.user_id !== userId) {
        return failure(
          createError("FORBIDDEN", "Only the creator can delete a stream"),
        );
      }

      // Delete all records in the stream
      await t.none(
        `DELETE FROM record 
         WHERE stream_id = $(streamId)`,
        { streamId },
      );

      // Delete the stream
      await t.none(
        `DELETE FROM stream 
         WHERE id = $(streamId)
           AND pod_name = $(pod_name)`,
        { streamId, pod_name: podName },
      );

      logger.info("Stream deleted", {
        podName,
        streamId,
      });
      return success(undefined);
    });
  } catch (error: unknown) {
    logger.error("Failed to delete stream", { error, podName, streamId });
    return failure(new Error("Failed to delete stream"));
  }
}
