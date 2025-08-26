/**
 * Delete a stream and all its records
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { createError } from "../../utils/errors.js";
import { StreamDbRow } from "../../db-types.js";
import { isSystemStream } from "../../utils.js";
import { createLogger } from "../../logger.js";

const logger = createLogger("webpods:domain:streams");

export async function deleteStream(
  ctx: DataContext,
  podName: string,
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
         WHERE pod_name = $(pod_name)
           AND name = $(name)`,
        { pod_name: podName, name: streamId },
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
         WHERE pod_name = $(pod_name)
           AND stream_name = $(stream_name)`,
        { pod_name: podName, stream_name: streamId },
      );

      // Delete the stream
      await t.none(
        `DELETE FROM stream 
         WHERE pod_name = $(pod_name)
           AND name = $(name)`,
        { pod_name: podName, name: streamId },
      );

      logger.info("Stream deleted", {
        podName,
        streamId,
      });
      return success(undefined);
    });
  } catch (error: any) {
    logger.error("Failed to delete stream", { error, podName, streamId });
    return failure(new Error("Failed to delete stream"));
  }
}
