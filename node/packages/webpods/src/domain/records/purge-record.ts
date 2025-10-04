/**
 * Purge (hard delete) a record by overwriting its content
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { createError } from "../../utils/errors.js";
import { createLogger } from "../../logger.js";
import { getStorageAdapter } from "../../storage-adapters/index.js";
import { extname } from "path";
import { cacheInvalidation } from "../../cache/index.js";
import { createContext, from, updateTable } from "@webpods/tinqer";
import { executeSelect, executeUpdate } from "@webpods/tinqer-sql-pg-promise";
import type { DatabaseSchema } from "../../db/schema.js";

const logger = createLogger("webpods:domain:records");
const dbContext = createContext<DatabaseSchema>();

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
    const latestRecords = await executeSelect(
      ctx.db,
      (p: { streamId: number; recordName: string }) =>
        from(dbContext, "record")
          .where((r) => r.stream_id === p.streamId && r.name === p.recordName)
          .orderByDescending((r) => r.index)
          .take(1)
          .select((r) => ({ deleted: r.deleted })),
      { streamId, recordName },
    );

    const latestRecord = latestRecords[0] || null;

    if (!latestRecord) {
      return failure(
        createError(
          "RECORD_NOT_FOUND",
          `Record '${recordName}' not found in stream`,
        ),
      );
    }

    // Find the last record with external storage info (skip deletion markers)
    const recordsWithStorage = await executeSelect(
      ctx.db,
      (p: { streamId: number; recordName: string }) =>
        from(dbContext, "record")
          .where(
            (r) =>
              r.stream_id === p.streamId &&
              r.name === p.recordName &&
              r.storage !== null,
          )
          .orderByDescending((r) => r.index)
          .take(1)
          .select((r) => ({
            storage: r.storage,
            content_hash: r.content_hash,
          })),
      { streamId, recordName },
    );

    const recordWithStorage = recordsWithStorage[0] || null;

    // If any record had external storage, purge the files
    if (recordWithStorage && recordWithStorage.storage) {
      const adapter = getStorageAdapter();
      if (adapter) {
        // Get pod and stream info for deletion
        const streamInfoResult = await executeSelect(
          ctx.db,
          (p: { streamId: number }) =>
            from(dbContext, "stream")
              .where((s) => s.id === p.streamId)
              .select((s) => ({ pod_name: s.pod_name, path: s.path })),
          { streamId },
        );

        if (!streamInfoResult[0]) {
          return failure(createError("STREAM_NOT_FOUND", "Stream not found"));
        }

        const streamInfo = streamInfoResult[0];

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
    const result = await executeUpdate(
      ctx.db,
      (p: { streamId: number; recordName: string; contentHash: string }) =>
        updateTable(dbContext, "record")
          .set(() => ({
            content: "",
            content_type: "text/plain",
            content_hash: p.contentHash,
            size: 0,
            storage: null,
            deleted: true,
            purged: true,
          }))
          .where((r) => r.stream_id === p.streamId && r.name === p.recordName),
      {
        streamId,
        recordName,
        contentHash: "purged", // Special marker for purged content
      },
    );

    logger.info("Record purged", {
      streamId,
      recordName,
      userId,
    });

    // Get stream info for cache invalidation
    const streamInfoResults = await executeSelect(
      ctx.db,
      (p: { streamId: number }) =>
        from(dbContext, "stream")
          .where((s) => s.id === p.streamId)
          .select((s) => ({ pod_name: s.pod_name, path: s.path })),
      { streamId },
    );

    const streamInfo = streamInfoResults[0] || null;

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
