/**
 * Delete a stream and all its records
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { StreamDbRow } from "../../db-types.js";
import { isSystemStream } from "../../utils.js";
import { createLogger } from "../../logger.js";

const logger = createLogger("webpods:domain:streams");

export async function deleteStream(
  ctx: DataContext,
  podId: string,
  streamId: string,
  userId: string,
): Promise<Result<void>> {
  // Cannot delete system streams
  if (isSystemStream(streamId)) {
    return failure(new Error("Cannot delete system streams"));
  }

  try {
    return await ctx.db.tx(async (t) => {
      // Get the stream
      const stream = await t.oneOrNone<StreamDbRow>(
        `SELECT * FROM stream
         WHERE pod_id = $(podId)
           AND stream_id = $(streamId)`,
        { podId, streamId },
      );

      if (!stream) {
        return failure(new Error("Stream not found"));
      }

      // Only the creator can delete a stream
      if (stream.user_id !== userId) {
        return failure(new Error("Forbidden: Only the creator can delete a stream"));
      }

      // Delete all records in the stream
      await t.none(
        `DELETE FROM record WHERE stream_id = $(streamId)`,
        { streamId: stream.id },
      );

      // Delete the stream
      await t.none(
        `DELETE FROM stream WHERE id = $(streamId)`,
        { streamId: stream.id },
      );

      logger.info("Stream deleted", { streamId: stream.id, podId, streamPath: streamId });
      return success(undefined);
    });
  } catch (error: any) {
    logger.error("Failed to delete stream", { error, podId, streamId });
    return failure(new Error("Failed to delete stream"));
  }
}