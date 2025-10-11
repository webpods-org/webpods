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
import { createSchema } from "@webpods/tinqer";
import { executeSelect, executeInsert } from "@webpods/tinqer-sql-pg-promise";
import type { DatabaseSchema } from "../../db/schema.js";

const logger = createLogger("webpods:domain:records");
const schema = createSchema<DatabaseSchema>();

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
      const latestRecordResults = await executeSelect(
        t,
        schema,
        (q, p) =>
          q
            .from("record")
            .select((r) => ({
              id: r.id,
              stream_id: r.stream_id,
              index: r.index,
              content_type: r.content_type,
              is_binary: r.is_binary,
              size: r.size,
              name: r.name,
              path: r.path,
              content_hash: r.content_hash,
              hash: r.hash,
              previous_hash: r.previous_hash,
              user_id: r.user_id,
              storage: r.storage,
              headers: r.headers,
              deleted: r.deleted,
              purged: r.purged,
              created_at: r.created_at,
            }))
            .where((r) => r.stream_id === p.streamId && r.name === p.recordName)
            .orderByDescending((r) => r.index)
            .take(1),
        { streamId, recordName },
      );

      const latestRecord = latestRecordResults[0] || null;

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
          const streamInfoResults = await executeSelect(
            t,
            schema,
            (q, p) =>
              q
                .from("stream")
                .select((s) => ({ pod_name: s.pod_name, path: s.path }))
                .where((s) => s.id === p.streamId)
                .take(1),
            { streamId },
          );
          const streamInfo = streamInfoResults[0];

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
      const lastRecordResults = await executeSelect(
        t,
        schema,
        (q, p) =>
          q
            .from("record")
            .select((r) => ({ index: r.index, hash: r.hash }))
            .where((r) => r.stream_id === p.streamId)
            .orderByDescending((r) => r.index)
            .take(1),
        { streamId },
      );

      const lastRecord = lastRecordResults[0] || null;

      const index = (lastRecord?.index ?? -1) + 1;
      const previousHash = lastRecord?.hash || null;
      const timestamp = Date.now();

      // Empty content for deletion marker
      const content = "";

      // Get stream path to compute record path
      const streamResults = await executeSelect(
        t,
        schema,
        (q, p) =>
          q
            .from("stream")
            .select((s) => ({ path: s.path }))
            .where((s) => s.id === p.streamId)
            .take(1),
        { streamId },
      );

      const stream = streamResults[0];
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
      const deletionRecordResults = await executeInsert(
        t,
        schema,
        (q, p) =>
          q
            .insertInto("record")
            .values({
              stream_id: p.streamId,
              index: p.index,
              content: p.content,
              content_type: p.contentType,
              is_binary: false,
              size: p.size,
              name: p.name,
              path: p.path,
              content_hash: p.contentHash,
              hash: p.hash,
              previous_hash: p.previousHash,
              user_id: p.userId,
              headers: "{}",
              deleted: true,
              purged: false,
              created_at: p.createdAt,
            })
            .returning((r) => ({
              id: r.id,
              index: r.index,
              hash: r.hash,
              previous_hash: r.previous_hash,
              name: r.name,
            })),
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

      const deletionRecord = deletionRecordResults[0];

      logger.info("Record soft deleted", {
        streamId,
        recordName,
        index,
        userId,
      });

      // Get stream info for cache invalidation
      const streamInfoResults2 = await executeSelect(
        t,
        schema,
        (q, p) =>
          q
            .from("stream")
            .select((s) => ({ pod_name: s.pod_name, path: s.path }))
            .where((s) => s.id === p.streamId)
            .take(1),
        { streamId },
      );
      const streamInfo = streamInfoResults2[0];

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
