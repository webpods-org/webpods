/**
 * List records from multiple streams recursively
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { RecordDbRow } from "../../db-types.js";
import { StreamRecord } from "../../types.js";
import { createLogger } from "../../logger.js";
import { getStreamsWithPrefix } from "../streams/get-streams-with-prefix.js";
import { canRead } from "../permissions/can-read.js";

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

export async function listRecordsRecursive(
  ctx: DataContext,
  podName: string,
  streamPath: string,
  userId: string | null,
  limit: number = 100,
  after?: number,
): Promise<
  Result<{ records: StreamRecord[]; total: number; hasMore: boolean }>
> {
  try {
    // Step 1: Get all matching streams
    const streamsResult = await getStreamsWithPrefix(ctx, podName, streamPath);

    if (!streamsResult.success) {
      return failure(streamsResult.error);
    }

    const streams = streamsResult.data;

    if (streams.length === 0) {
      // No streams found
      return success({
        records: [],
        total: 0,
        hasMore: false,
      });
    }

    // Step 2: Check permissions for each stream
    const readableStreams = [];
    for (const stream of streams) {
      const canReadResult = await canRead(ctx, stream, userId);
      if (canReadResult) {
        readableStreams.push(stream);
      }
    }

    if (readableStreams.length === 0) {
      // No readable streams
      return success({
        records: [],
        total: 0,
        hasMore: false,
      });
    }

    // Step 3: Get readable stream IDs for efficient query
    const readableStreamIds = readableStreams.map((stream) => stream.id);

    // Step 4: Get total count with a single efficient query
    const countResult = await ctx.db.one<{ count: string }>(
      `SELECT COUNT(*) as count 
       FROM record 
       WHERE stream_id = ANY($(streamIds)::bigint[])
         AND deleted = false
         AND purged = false`,
      { streamIds: readableStreamIds },
    );

    const totalCount = parseInt(countResult.count);

    // Handle negative 'after' parameter
    let actualAfter = after;
    if (after !== undefined && after < 0) {
      // after=-3 means "get the last 3 records"
      actualAfter = totalCount + after;
      if (actualAfter < 0) {
        actualAfter = 0; // Get all from start
      }
    }

    // Step 5: Use single efficient query with proper ordering and pagination
    let query = `
      SELECT r.* 
      FROM record r
      WHERE r.stream_id = ANY($(streamIds)::bigint[])
        AND r.deleted = false
        AND r.purged = false
      ORDER BY r.created_at ASC`;

    // Add pagination parameters
    const params: Record<string, unknown> = {
      streamIds: readableStreamIds,
      limit: limit + 1, // Get one extra to check hasMore
    };

    if (actualAfter !== undefined && actualAfter >= 0) {
      query += ` OFFSET $(offset)`;
      params.offset = actualAfter;
    }

    query += ` LIMIT $(limit)`;

    const records = await ctx.db.manyOrNone<RecordDbRow>(query, params);

    // Check if there are more records
    const hasMore = records.length > limit;
    const paginatedRecords = hasMore ? records.slice(0, limit) : records;

    logger.debug("Listed records recursively", {
      podName,
      streamPath,
      streamCount: readableStreams.length,
      totalRecords: totalCount,
      returnedRecords: paginatedRecords.length,
      hasMore,
    });

    return success({
      records: paginatedRecords.map(mapRecordFromDb),
      total: totalCount,
      hasMore,
    });
  } catch (error: unknown) {
    logger.error("Failed to list records recursively", {
      error,
      podName,
      streamPath,
      limit,
      after,
    });
    return failure(new Error("Failed to list records recursively"));
  }
}
