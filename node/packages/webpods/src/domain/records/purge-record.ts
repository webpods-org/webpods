/**
 * Purge (hard delete) a record by overwriting its content
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { createError } from "../../utils/errors.js";
import { createLogger } from "../../logger.js";

const logger = createLogger("webpods:domain:records");

/**
 * Purge a record by overwriting its content with deletion metadata
 * This is a hard delete that overwrites the actual record content
 *
 * @param ctx Data context
 * @param streamId Stream ID
 * @param recordName Record name to purge
 * @param userId User ID performing the purge
 * @returns Success result if purged, failure if not found
 */
export async function purgeRecord(
  ctx: DataContext,
  streamId: number,
  recordName: string,
  userId: string,
): Promise<Result<{ rowsAffected: number }>> {
  try {
    const result = await ctx.db.result(
      `UPDATE record
       SET content = $(content),
           content_type = $(contentType),
           content_hash = $(contentHash)
       WHERE stream_id = $(streamId)
         AND name = $(recordName)`,
      {
        streamId,
        recordName,
        content: JSON.stringify({
          deleted: true,
          purged: true,
          purgedAt: new Date().toISOString(),
          purgedBy: userId,
        }),
        contentType: "application/json",
        contentHash: "purged", // Special marker for purged content
      },
      (r) => r.rowCount,
    );

    if (result === 0) {
      return failure(
        createError(
          "RECORD_NOT_FOUND",
          `Record '${recordName}' not found in stream`,
        ),
      );
    }

    logger.info("Record purged", {
      streamId,
      recordName,
      userId,
    });

    return success({ rowsAffected: result });
  } catch (error: unknown) {
    logger.error("Failed to purge record", {
      error,
      streamId,
      recordName,
      userId,
    });
    return failure(createError("PURGE_ERROR", "Failed to purge record"));
  }
}
