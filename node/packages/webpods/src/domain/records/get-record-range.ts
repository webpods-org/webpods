/**
 * Get a range of records from a stream
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { RecordDbRow } from "../../db-types.js";
import { StreamRecord } from "../../types.js";
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
    size: row.size,
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

export async function getRecordRange(
  ctx: DataContext,
  podName: string,
  streamId: number,
  startIndex: number,
  endIndex: number,
): Promise<Result<StreamRecord[]>> {
  try {
    let actualStartIndex = startIndex;
    let actualEndIndex = endIndex;

    // Handle negative indices
    if (startIndex < 0 || endIndex < 0) {
      const countResult = await ctx.db.one<{ count: string }>(
        `SELECT COUNT(*) as count FROM record WHERE stream_id = $(streamId) `,
        { streamId },
      );
      const totalCount = parseInt(countResult.count);

      if (startIndex < 0) {
        actualStartIndex = totalCount + startIndex;
      }
      if (endIndex < 0) {
        actualEndIndex = totalCount + endIndex;
      }
    }

    // Ensure valid range
    if (actualStartIndex < 0) actualStartIndex = 0;
    if (actualEndIndex < actualStartIndex) {
      return success([]);
    }

    const records = await ctx.db.manyOrNone<RecordDbRow>(
      `SELECT * FROM record
       WHERE stream_id = $(streamId)
         AND index >= $(start_index)
         AND index < $(end_index)
       ORDER BY index ASC`,
      {
        streamId,
        start_index: actualStartIndex,
        end_index: actualEndIndex,
      },
    );

    return success(records.map(mapRecordFromDb));
  } catch (error: unknown) {
    logger.error("Failed to get record range", {
      error,
      podName,
      streamId,
      startIndex,
      endIndex,
    });
    return failure(new Error("Failed to get record range"));
  }
}
