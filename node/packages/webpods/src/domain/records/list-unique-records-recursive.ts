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

    // Step 3: Use path-based query to get all unique records efficiently
    // This uses a single query with DISTINCT ON to get latest version of each named record
    const pathPattern = streamPath.endsWith("/")
      ? `${streamPath}%`
      : `${streamPath}/%`;

    // First, get total count of unique records
    const countResult = await ctx.db.one<{ count: string }>(
      `WITH latest_records AS (
        SELECT DISTINCT ON (name) *
        FROM record
        WHERE stream_id = ANY($(streamIds)::bigint[])
          AND path LIKE $(pathPattern)
          AND name IS NOT NULL
          AND name != ''
        ORDER BY name, index DESC
      )
      SELECT COUNT(*) as count FROM latest_records`,
      {
        streamIds: readableStreamIds,
        pathPattern,
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
        SELECT DISTINCT ON (name) *
        FROM record
        WHERE stream_id = ANY($(streamIds)::bigint[])
          AND path LIKE $(pathPattern)
          AND name IS NOT NULL
          AND name != ''
        ORDER BY name, index DESC
      )
      SELECT * FROM latest_records
      ORDER BY index ASC`;

    // Add pagination
    const params: Record<string, unknown> = {
      streamIds: readableStreamIds,
      pathPattern,
      limit: limit + 1, // Get one extra to check hasMore
    };

    if (actualAfter !== undefined && actualAfter >= 0) {
      query += ` OFFSET $(offset)`;
      params.offset = actualAfter;
    }

    query += ` LIMIT $(limit)`;

    const records = await ctx.db.manyOrNone<RecordDbRow>(query, params);

    // Filter out deleted records in memory
    const filteredRecords = records.filter((record) => {
      if (record.content_type === "application/json" && record.content) {
        try {
          const content = JSON.parse(record.content);
          if (
            content &&
            typeof content === "object" &&
            (content.deleted === true || content.purged === true)
          ) {
            return false; // Exclude deleted/purged records
          }
        } catch {
          // Not valid JSON, include it
        }
      }
      return true;
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
