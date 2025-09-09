/**
 * Get a record by index or alias
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { RecordDbRow } from "../../db-types.js";
import { StreamRecord } from "../../types.js";
import { isNumericIndex } from "../../utils.js";
import { createLogger } from "../../logger.js";

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
    name: row.name,
    path: row.path,
    contentHash: row.content_hash,
    hash: row.hash,
    previousHash: row.previous_hash || null,
    userId: row.user_id,
    metadata: undefined,
    createdAt:
      typeof row.created_at === "string"
        ? new Date(row.created_at)
        : row.created_at,
  };
}

export async function getRecord(
  ctx: DataContext,
  podName: string,
  streamId: number,
  target: string,
  preferName: boolean = false,
): Promise<Result<StreamRecord>> {
  try {
    let record: RecordDbRow | null = null;

    // If preferName is true, try name first even if target is numeric
    if (preferName) {
      // Try to get by name first - get the latest record with this name
      record = await ctx.db.oneOrNone<RecordDbRow>(
        `SELECT * FROM record
         WHERE stream_id = $(streamId)
           
           AND name = $(name)
         ORDER BY index DESC
         LIMIT 1`,
        { streamId, name: target },
      );

      // If not found as name and target is numeric, try as index
      if (!record && isNumericIndex(target)) {
        let index = parseInt(target);

        // Handle negative indexing
        if (index < 0) {
          const countResult = await ctx.db.one<{ count: string }>(
            `SELECT COUNT(*) as count FROM record WHERE stream_id = $(streamId) `,
            { streamId },
          );

          index = parseInt(countResult.count) + index;
          if (index < 0) {
            return failure(new Error("Record not found"));
          }
        }

        record = await ctx.db.oneOrNone<RecordDbRow>(
          `SELECT * FROM record
           WHERE stream_id = $(streamId)
             
             AND index = $(index)`,
          { streamId, index },
        );
      }
    } else if (isNumericIndex(target)) {
      // Target is numeric, treat as index
      let index = parseInt(target);

      // Handle negative indexing
      if (index < 0) {
        const countResult = await ctx.db.one<{ count: string }>(
          `SELECT COUNT(*) as count FROM record WHERE stream_id = $(streamId) `,
          { streamId },
        );

        index = parseInt(countResult.count) + index;
        if (index < 0) {
          return failure(new Error("Record not found"));
        }
      }

      record = await ctx.db.oneOrNone<RecordDbRow>(
        `SELECT * FROM record
         WHERE stream_id = $(streamId)
           
           AND index = $(index)`,
        { streamId, index },
      );
    } else {
      // Target is not numeric, treat as name - get the latest record with this name
      record = await ctx.db.oneOrNone<RecordDbRow>(
        `SELECT * FROM record
         WHERE stream_id = $(streamId)
           
           AND name = $(name)
         ORDER BY index DESC
         LIMIT 1`,
        { streamId, name: target },
      );
    }

    if (!record) {
      return failure(new Error("Record not found"));
    }

    return success(mapRecordFromDb(record));
  } catch (error: unknown) {
    logger.error("Failed to get record", { error, podName, streamId, target });
    return failure(new Error("Failed to get record"));
  }
}
