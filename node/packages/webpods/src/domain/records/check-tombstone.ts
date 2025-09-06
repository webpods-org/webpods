/**
 * Check if a record has been soft-deleted by looking for tombstone records
 */

import { DataContext } from "../data-context.js";
import { RecordDbRow } from "../../db-types.js";
import { createLogger } from "../../logger.js";

const logger = createLogger("webpods:domain:records");

/**
 * Check if there's a tombstone record for a given record name
 * that's newer than the specified index
 *
 * @param ctx Data context
 * @param streamId Stream ID
 * @param recordName Record name to check
 * @param afterIndex Check for tombstones after this index
 * @returns True if a newer tombstone exists
 */
export async function hasTombstone(
  ctx: DataContext,
  streamId: number,
  recordName: string,
  afterIndex: number,
): Promise<boolean> {
  try {
    const tombstonePattern = `${recordName}.deleted.%`;
    const tombstones = await ctx.db.manyOrNone<RecordDbRow>(
      `SELECT * FROM record
       WHERE stream_id = $(streamId)
         AND name LIKE $(pattern)
         AND index > $(index)
       ORDER BY index DESC
       LIMIT 1`,
      {
        streamId,
        pattern: tombstonePattern,
        index: afterIndex,
      },
    );

    return tombstones.length > 0;
  } catch (error: unknown) {
    logger.error("Failed to check tombstone", {
      error,
      streamId,
      recordName,
      afterIndex,
    });
    return false;
  }
}

/**
 * Get the latest tombstone record for a given record name
 *
 * @param ctx Data context
 * @param streamId Stream ID
 * @param recordName Record name to check
 * @returns The tombstone record if found, null otherwise
 */
export async function getLatestTombstone(
  ctx: DataContext,
  streamId: number,
  recordName: string,
): Promise<RecordDbRow | null> {
  try {
    const tombstonePattern = `${recordName}.deleted.%`;
    const tombstone = await ctx.db.oneOrNone<RecordDbRow>(
      `SELECT * FROM record
       WHERE stream_id = $(streamId)
         AND name LIKE $(pattern)
       ORDER BY index DESC
       LIMIT 1`,
      {
        streamId,
        pattern: tombstonePattern,
      },
    );

    return tombstone;
  } catch (error: unknown) {
    logger.error("Failed to get tombstone", {
      error,
      streamId,
      recordName,
    });
    return null;
  }
}
