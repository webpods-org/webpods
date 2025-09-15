/**
 * Soft delete a record by adding a deletion marker
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { createError } from "../../utils/errors.js";
import { RecordDbRow } from "../../db-types.js";
import { calculateContentHash, calculateRecordHash } from "../../utils.js";
import { createLogger } from "../../logger.js";
import { getStorageAdapter } from "../../storage-adapters/index.js";
import { extname } from "path";
import { cacheInvalidation } from "../../cache/index.js";

const logger = createLogger("webpods:domain:records");

/**
 * Minimal result type for delete operations
 */
export type DeleteRecordResult = {
  id: number;
  index: number;
  hash: string;
  previousHash: string | null;
  name: string;
};

/**
 * Map database row to minimal delete result
 */
function mapToDeleteResult(
  row: Pick<RecordDbRow, "id" | "index" | "hash" | "previous_hash" | "name">,
): DeleteRecordResult {
  return {
    id: row.id || 0,
    index: row.index,
    hash: row.hash,
    previousHash: row.previous_hash || null,
    name: row.name,
  };
}

/**
 * Soft delete a record by adding a deletion marker record
 *
 * @param ctx Data context
 * @param streamId Stream ID
 * @param recordName Record name to delete
 * @param userId User ID performing the deletion
 * @returns The created deletion record
 */
export async function deleteRecord(
  ctx: DataContext,
  streamId: number,
  recordName: string,
  userId: string,
): Promise<Result<DeleteRecordResult>> {
  try {
    return await ctx.db.tx(async (t) => {
      // First get the latest record with this name to check if it's already deleted
      // We need several fields but NOT the large content field
      const latestRecord = await t.oneOrNone<Omit<RecordDbRow, "content">>(
        `SELECT id, stream_id, index, content_type, is_binary, size, name, path,
                content_hash, hash, previous_hash, user_id, storage, headers,
                deleted, purged, created_at
         FROM record
         WHERE stream_id = $(streamId)
           AND name = $(recordName)
         ORDER BY index DESC
         LIMIT 1`,
        { streamId, recordName },
      );

      if (!latestRecord) {
        return failure(
          createError("RECORD_NOT_FOUND", `Record '${recordName}' not found`),
        );
      }

      // If already deleted, do nothing (idempotent)
      if (latestRecord.deleted) {
        logger.info("Record already deleted", {
          streamId,
          recordName,
        });
        // Return minimal result for already deleted record
        return success({
          id: latestRecord.id || 0,
          index: latestRecord.index,
          hash: latestRecord.hash,
          previousHash: latestRecord.previous_hash || null,
          name: latestRecord.name,
        });
      }

      const recordToDelete = latestRecord;

      // If record has external storage, soft delete the name-based file
      if (recordToDelete.storage) {
        const adapter = getStorageAdapter();
        if (adapter) {
          // Get pod and stream info for deletion
          const streamInfo = await t.one<{ pod_name: string; path: string }>(
            `SELECT pod_name, path FROM stream WHERE id = $(streamId)`,
            { streamId },
          );

          // Extract file extension from name only - don't add one if name has none
          const ext = extname(recordName).replace(".", "");

          // Soft delete - only remove name-based file, keep hash file
          const deleteResult = await adapter.deleteFile(
            streamInfo.pod_name,
            streamInfo.path,
            recordName,
            recordToDelete.content_hash,
            ext,
            false, // soft delete - don't purge hash file
          );

          if (!deleteResult.success) {
            logger.warn("Failed to delete external file during soft delete", {
              error: deleteResult.error,
              recordName,
              storage: recordToDelete.storage,
            });
          }
        }
      }

      // First, lock the stream row to serialize writes to this stream
      // This handles both empty streams (no records) and streams with existing records
      await t.one<{ id: number }>(
        `SELECT id FROM stream
         WHERE id = $(streamId)
         FOR UPDATE`,
        { streamId },
      );

      // Get the last record to calculate the next index and hash chain
      // No need for FOR UPDATE here since the stream lock serializes access
      const lastRecord = await t.oneOrNone<Pick<RecordDbRow, "index" | "hash">>(
        `SELECT index, hash FROM record
         WHERE stream_id = $(streamId)
         ORDER BY index DESC
         LIMIT 1`,
        { streamId },
      );

      const index = (lastRecord?.index ?? -1) + 1;
      const previousHash = lastRecord?.hash || null;
      const timestamp = new Date().toISOString();

      // Empty content for deletion marker
      const content = "";

      // Get stream path to compute record path
      const stream = await t.one<{ path: string }>(
        `SELECT path FROM stream WHERE id = $(streamId)`,
        { streamId },
      );

      const recordPath = `${stream.path}/${recordName}`;

      // Calculate hashes and size
      const contentHash = calculateContentHash(content);
      const hash = calculateRecordHash(
        previousHash,
        contentHash,
        userId,
        timestamp,
      );
      const size = 0; // Empty content

      // Insert deletion marker record with deleted=true
      // Only fetch the fields we need for the result
      const deletionRecord = await t.one<
        Pick<RecordDbRow, "id" | "index" | "hash" | "previous_hash" | "name">
      >(
        `INSERT INTO record (stream_id, index, content, content_type, size, name, path, content_hash, hash, previous_hash, user_id, deleted, created_at)
         VALUES ($(streamId), $(index), $(content), $(contentType), $(size), $(name), $(path), $(contentHash), $(hash), $(previousHash), $(userId), true, $(createdAt))
         RETURNING id, index, hash, previous_hash, name`,
        {
          streamId,
          index,
          content,
          contentType: "text/plain",
          size,
          name: recordName,
          path: recordPath,
          contentHash,
          hash,
          previousHash,
          userId,
          createdAt: timestamp,
        },
      );

      logger.info("Record soft deleted", {
        streamId,
        recordName,
        index,
        userId,
      });

      // Get stream info for cache invalidation
      const streamInfo = await t.one<{ pod_name: string; path: string }>(
        `SELECT pod_name, path FROM stream WHERE id = $(streamId)`,
        { streamId },
      );

      // Invalidate caches for the deleted record
      await cacheInvalidation.invalidateRecord(
        streamInfo.pod_name,
        streamInfo.path,
        recordName,
      );

      return success(mapToDeleteResult(deletionRecord));
    });
  } catch (error: unknown) {
    logger.error("Failed to soft delete record", {
      error,
      streamId,
      recordName,
      userId,
    });
    return failure(createError("DELETE_ERROR", "Failed to delete record"));
  }
}
