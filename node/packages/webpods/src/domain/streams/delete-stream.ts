/**
 * Delete a stream and all its records
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { createError } from "../../utils/errors.js";
import { StreamDbRow } from "../../db-types.js";
import { isSystemStream } from "../../utils.js";
import { createLogger } from "../../logger.js";
import { normalizeStreamName } from "../../utils/stream-utils.js";

const logger = createLogger("webpods:domain:streams");

export async function deleteStream(
  ctx: DataContext,
  podName: string,
  streamId: string,
  userId: string,
): Promise<Result<void>> {
  // Normalize stream name to ensure leading slash
  const normalizedStreamId = normalizeStreamName(streamId);

  // Cannot delete system streams (check both forms)
  if (isSystemStream(streamId) || isSystemStream(normalizedStreamId)) {
    return failure(new Error("Cannot delete system streams"));
  }

  try {
    return await ctx.db.tx(async (t) => {
      // Get the stream (using normalized name)
      const stream = await t.oneOrNone<StreamDbRow>(
        `SELECT * FROM stream
         WHERE pod_name = $(pod_name)
           AND name = $(name)`,
        { pod_name: podName, name: normalizedStreamId },
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

      // Delete all records in the stream (using normalized name)
      await t.none(
        `DELETE FROM record 
         WHERE pod_name = $(pod_name)
           AND stream_name = $(stream_name)`,
        { pod_name: podName, stream_name: normalizedStreamId },
      );

      // Delete the stream (using normalized name)
      await t.none(
        `DELETE FROM stream 
         WHERE pod_name = $(pod_name)
           AND name = $(name)`,
        { pod_name: podName, name: normalizedStreamId },
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
