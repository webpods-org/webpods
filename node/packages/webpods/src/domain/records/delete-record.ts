/**
 * Soft delete a record by adding a tombstone record
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { createError } from "../../utils/errors.js";
import { RecordDbRow } from "../../db-types.js";
import { StreamRecord } from "../../types.js";
import { calculateContentHash, calculateRecordHash } from "../../utils.js";
import { createLogger } from "../../logger.js";
import { getStorageAdapter } from "../../storage-adapters/index.js";
import { extname } from "path";

const logger = createLogger("webpods:domain:records");

/**
 * Map database row to domain type
 */
function mapRecordFromDb(row: RecordDbRow): StreamRecord {
  return {
    id: row.id || 0,
    streamId: row.stream_id,
    index: row.index,
    content: row.content,
    contentType: row.content_type,
    isBinary: row.is_binary,
    size: row.size,
    name: row.name,
    path: row.path,
    contentHash: row.content_hash,
    hash: row.hash,
    previousHash: row.previous_hash || null,
    userId: row.user_id,
    storage: row.storage || null,
    headers: row.headers,
    metadata: undefined,
    createdAt:
      typeof row.created_at === "string"
        ? new Date(row.created_at)
        : row.created_at,
  };
}

/**
 * Soft delete a record by adding a tombstone record
 * The tombstone has a name like "original.deleted.timestamp"
 *
 * @param ctx Data context
 * @param streamId Stream ID
 * @param recordName Record name to delete
 * @param userId User ID performing the deletion
 * @returns The created tombstone record
 */
export async function deleteRecord(
  ctx: DataContext,
  streamId: number,
  recordName: string,
  userId: string,
): Promise<Result<StreamRecord>> {
  try {
    return await ctx.db.tx(async (t) => {
      // First check if the record exists and has external storage
      const recordToDelete = await t.oneOrNone<RecordDbRow>(
        `SELECT * FROM record
         WHERE stream_id = $(streamId)
           AND name = $(recordName)
         ORDER BY index DESC
         LIMIT 1`,
        { streamId, recordName },
      );

      // If record has external storage, soft delete the name-based file
      if (recordToDelete?.storage) {
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

      // Get the last record to calculate the next index and hash chain
      const lastRecord = await t.oneOrNone<RecordDbRow>(
        `SELECT * FROM record
         WHERE stream_id = $(streamId)
         ORDER BY index DESC
         LIMIT 1`,
        { streamId },
      );

      const index = (lastRecord?.index ?? -1) + 1;
      const previousHash = lastRecord?.hash || null;
      const timestamp = new Date().toISOString();

      // Create tombstone name with timestamp
      const tombstoneName = `${recordName}.deleted.${Date.now()}`;

      // Tombstone content
      const content = JSON.stringify({
        deleted: true,
        originalName: recordName,
        deletedAt: timestamp,
        deletedBy: userId,
      });

      // Get stream path to compute record path
      const stream = await t.one<{ path: string }>(
        `SELECT path FROM stream WHERE id = $(streamId)`,
        { streamId },
      );

      const tombstonePath = `${stream.path}/${tombstoneName}`;

      // Calculate hashes and size
      const contentHash = calculateContentHash(content);
      const hash = calculateRecordHash(
        previousHash,
        contentHash,
        userId,
        timestamp,
      );
      const size = Buffer.byteLength(content, "utf8");

      // Insert tombstone record with path
      const tombstone = await t.one<RecordDbRow>(
        `INSERT INTO record (stream_id, index, content, content_type, size, name, path, content_hash, hash, previous_hash, user_id, created_at)
         VALUES ($(streamId), $(index), $(content), $(contentType), $(size), $(name), $(path), $(contentHash), $(hash), $(previousHash), $(userId), $(createdAt))
         RETURNING *`,
        {
          streamId,
          index,
          content,
          contentType: "application/json",
          size,
          name: tombstoneName,
          path: tombstonePath,
          contentHash,
          hash,
          previousHash,
          userId,
          createdAt: timestamp,
        },
      );

      logger.info("Record soft deleted with tombstone", {
        streamId,
        originalName: recordName,
        tombstoneName,
        index,
        userId,
      });

      return success(mapRecordFromDb(tombstone));
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
