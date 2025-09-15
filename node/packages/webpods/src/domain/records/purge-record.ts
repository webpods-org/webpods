/**
 * Purge (hard delete) a record by overwriting its content
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { createError } from "../../utils/errors.js";
import { createLogger } from "../../logger.js";
import { getStorageAdapter } from "../../storage-adapters/index.js";
import { extname } from "path";
import { RecordDbRow } from "../../db-types.js";
import { cacheInvalidation } from "../../cache/index.js";

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
    // First check if any record exists with this name
    const latestRecord = await ctx.db.oneOrNone<Pick<RecordDbRow, "deleted">>(
      `SELECT deleted FROM record
       WHERE stream_id = $(streamId)
         AND name = $(recordName)
       ORDER BY index DESC
       LIMIT 1`,
      { streamId, recordName },
    );

    if (!latestRecord) {
      return failure(
        createError(
          "RECORD_NOT_FOUND",
          `Record '${recordName}' not found in stream`,
        ),
      );
    }

    // Find the last record with external storage info (skip deletion markers)
    const recordWithStorage = await ctx.db.oneOrNone<
      Pick<RecordDbRow, "storage" | "content_hash">
    >(
      `SELECT storage, content_hash FROM record
       WHERE stream_id = $(streamId)
         AND name = $(recordName)
         AND storage IS NOT NULL
       ORDER BY index DESC
       LIMIT 1`,
      { streamId, recordName },
    );

    // If any record had external storage, purge the files
    if (recordWithStorage && recordWithStorage.storage) {
      const adapter = getStorageAdapter();
      if (adapter) {
        // Get pod and stream info for deletion
        const streamInfo = await ctx.db.one<{ pod_name: string; path: string }>(
          `SELECT pod_name, path FROM stream WHERE id = $(streamId)`,
          { streamId },
        );

        // Extract file extension from name only - don't add one if name has none
        const ext = extname(recordName).replace(".", "");

        // Purge - delete both name-based and hash files
        const deleteResult = await adapter.deleteFile(
          streamInfo.pod_name,
          streamInfo.path,
          recordName,
          recordWithStorage.content_hash,
          ext,
          true, // purge - delete both files
        );

        if (!deleteResult.success) {
          logger.warn("Failed to purge external files", {
            error: deleteResult.error,
            recordName,
            storage: recordWithStorage.storage,
          });
        }
      }
    }

    // Update the record in the database - set both deleted and purged flags and clear content
    const result = await ctx.db.result(
      `UPDATE record
       SET content = '',
           content_type = 'text/plain',
           content_hash = $(contentHash),
           size = 0,
           storage = NULL,
           deleted = true,
           purged = true
       WHERE stream_id = $(streamId)
         AND name = $(recordName)`,
      {
        streamId,
        recordName,
        contentHash: "purged", // Special marker for purged content
      },
      (r) => r.rowCount,
    );

    logger.info("Record purged", {
      streamId,
      recordName,
      userId,
    });

    // Get stream info for cache invalidation
    const streamInfo = await ctx.db.oneOrNone<{
      pod_name: string;
      path: string;
    }>(`SELECT pod_name, path FROM stream WHERE id = $(streamId)`, {
      streamId,
    });

    // Invalidate caches for the purged record
    if (streamInfo) {
      await cacheInvalidation.invalidateRecord(
        streamInfo.pod_name,
        streamInfo.path,
        recordName,
      );
    }

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
