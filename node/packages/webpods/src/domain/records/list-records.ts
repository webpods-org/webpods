/**
 * List records in a stream
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
    id: row.id ? parseInt(row.id) : 0,
    stream_pod_name: row.stream_pod_name,
    stream_name: row.stream_name,
    index: row.index,
    content: row.content,
    content_type: row.content_type,
    name: row.name || "",
    hash: row.hash,
    previous_hash: row.previous_hash || null,
    user_id: row.user_id,
    metadata: undefined,
    created_at:
      typeof row.created_at === "string"
        ? new Date(row.created_at)
        : row.created_at,
  };
}

export async function listRecords(
  ctx: DataContext,
  podName: string,
  streamId: string,
  limit: number = 100,
  after?: number,
): Promise<
  Result<{ records: StreamRecord[]; total: number; hasMore: boolean }>
> {
  try {
    let query = `SELECT * FROM record 
                  WHERE stream_pod_name = $(pod_name) 
                    AND stream_name = $(stream_name)`;
    const params: any = {
      pod_name: podName,
      stream_name: streamId,
      limit: limit + 1,
    };

    // Handle negative 'after' parameter
    let actualAfter = after;
    if (after !== undefined && after < 0) {
      // Get total count to convert negative index
      const countResult = await ctx.db.one<{ count: string }>(
        `SELECT COUNT(*) as count FROM record 
         WHERE stream_pod_name = $(pod_name) 
           AND stream_name = $(stream_name)`,
        { pod_name: podName, stream_name: streamId },
      );
      const totalCount = parseInt(countResult.count);
      // after=-3 means "get the last 3 records", so we skip totalCount-3 records
      // This means we want records after index (totalCount + after - 1)
      actualAfter = totalCount + after - 1; // e.g., 5 + (-3) - 1 = 1, so index > 1 gives indices 2,3,4

      // If still negative after conversion, start from beginning
      if (actualAfter < 0) {
        actualAfter = -1; // This will get all records from start
      }
    }

    if (actualAfter !== undefined) {
      query += ` AND index > $(after)`;
      params.after = actualAfter;
    }

    query += ` ORDER BY index ASC LIMIT $(limit)`;

    const records = await ctx.db.manyOrNone<RecordDbRow>(query, params);

    const countResult = await ctx.db.one<{ count: string }>(
      `SELECT COUNT(*) as count FROM record 
       WHERE stream_pod_name = $(pod_name) 
         AND stream_name = $(stream_name)`,
      { pod_name: podName, stream_name: streamId },
    );

    const total = parseInt(countResult.count);
    const hasMore = records.length > limit;

    if (hasMore) {
      records.pop(); // Remove the extra record
    }

    return success({
      records: records.map(mapRecordFromDb),
      total,
      hasMore,
    });
  } catch (error: any) {
    logger.error("Failed to list records", {
      error,
      podName,
      streamId,
      limit,
      after,
    });
    return failure(new Error("Failed to list records"));
  }
}
