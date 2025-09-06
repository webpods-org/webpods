/**
 * List records in a stream
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { RecordDbRow } from "../../db-types.js";
import { StreamRecord } from "../../types.js";
import { createLogger } from "../../logger.js";
import { normalizeStreamName } from "../../utils/stream-utils.js";

const logger = createLogger("webpods:domain:records");

/**
 * Map database row to domain type
 */
function mapRecordFromDb(row: RecordDbRow): StreamRecord {
  return {
    id: row.id ? parseInt(row.id) : 0,
    podName: row.pod_name,
    streamName: row.stream_name,
    index: row.index,
    content: row.content,
    contentType: row.content_type,
    name: row.name || "",
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

export async function listRecords(
  ctx: DataContext,
  podName: string,
  streamId: string,
  limit: number = 100,
  after?: number,
): Promise<
  Result<{ records: StreamRecord[]; total: number; hasMore: boolean }>
> {
  // Normalize stream name to ensure leading slash
  const normalizedStreamId = normalizeStreamName(streamId);

  try {
    let query = `SELECT * FROM record 
                  WHERE pod_name = $(pod_name) 
                    AND stream_name = $(stream_name)`;
    const params: Record<string, unknown> = {
      pod_name: podName,
      stream_name: normalizedStreamId,
      limit: limit + 1,
    };

    // Handle negative 'after' parameter
    let actualAfter = after;
    if (after !== undefined && after < 0) {
      // Get total count to convert negative index (using normalized stream name)
      const countResult = await ctx.db.one<{ count: string }>(
        `SELECT COUNT(*) as count FROM record 
         WHERE pod_name = $(pod_name) 
           AND stream_name = $(stream_name)`,
        { pod_name: podName, stream_name: normalizedStreamId },
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
       WHERE pod_name = $(pod_name) 
         AND stream_name = $(stream_name)`,
      { pod_name: podName, stream_name: normalizedStreamId },
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
  } catch (error: unknown) {
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
