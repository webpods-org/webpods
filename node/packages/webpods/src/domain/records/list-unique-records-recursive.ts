/**
 * List unique records recursively using path-based optimization
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

export async function listUniqueRecordsRecursive(
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
    // Step 1: Get all matching streams to check permissions
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
    const readableStreamIds: number[] = [];
    for (const stream of streams) {
      const canReadResult = await canRead(ctx, stream, userId);
      if (canReadResult) {
        readableStreamIds.push(stream.id);
      }
    }

    if (readableStreamIds.length === 0) {
      // No readable streams
      return success({
        records: [],
        total: 0,
        hasMore: false,
      });
    }

    // Step 3: Use efficient query to get all unique records
    // This uses a single query with DISTINCT ON to get latest version of each named record PER STREAM

    // First, get total count of unique records
    // For recursive unique, we want the latest record with each name FROM EACH STREAM
    const countResult = await ctx.db.one<{ count: string }>(
      `WITH latest_records AS (
        SELECT DISTINCT ON (stream_id, name) *
        FROM record
        WHERE stream_id = ANY($(streamIds)::bigint[])
          AND name IS NOT NULL
          AND name != ''
        ORDER BY stream_id, name, index DESC
      )
      SELECT COUNT(*) as count FROM latest_records`,
      {
        streamIds: readableStreamIds,
      },
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

    // Now get the actual records with pagination
    // Note: We'll filter deleted records in memory since content is TEXT not JSONB
    let query = `
      WITH latest_records AS (
        SELECT DISTINCT ON (stream_id, name) *
        FROM record
        WHERE stream_id = ANY($(streamIds)::bigint[])
          AND name IS NOT NULL
          AND name != ''
        ORDER BY stream_id, name, index DESC
      )
      SELECT * FROM latest_records
      ORDER BY index ASC`;

    // Add pagination
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

    // Filter out deleted records using the deleted/purged columns
    const filteredRecords = records.filter((record) => {
      return !record.deleted && !record.purged;
    });

    // Check if there are more records
    const hasMore = filteredRecords.length > limit;
    const resultRecords = hasMore
      ? filteredRecords.slice(0, limit)
      : filteredRecords;

    logger.debug("Listed unique records recursively", {
      podName,
      streamPath,
      streamCount: readableStreamIds.length,
      totalRecords: totalCount,
      returnedRecords: resultRecords.length,
      hasMore,
    });

    return success({
      records: resultRecords.map(mapRecordFromDb),
      total: totalCount,
      hasMore,
    });
  } catch (error: unknown) {
    logger.error("Failed to list unique records recursively", {
      error,
      podName,
      streamPath,
      limit,
      after,
    });
    return failure(new Error("Failed to list unique records recursively"));
  }
}
