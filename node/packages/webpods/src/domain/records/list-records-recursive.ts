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

    // Step 3: Fetch records from each readable stream
    const allRecords: RecordDbRow[] = [];
    let totalCount = 0;

    for (const stream of readableStreams) {
      // Get records from this stream
      const records = await ctx.db.manyOrNone<RecordDbRow>(
        `SELECT * FROM record 
         WHERE stream_id = $(streamId) 
         ORDER BY index ASC`,
        { streamId: stream.id },
      );

      allRecords.push(...records);

      // Get count for this stream
      const countResult = await ctx.db.one<{ count: string }>(
        `SELECT COUNT(*) as count FROM record 
         WHERE stream_id = $(streamId)`,
        { streamId: stream.id },
      );

      totalCount += parseInt(countResult.count);
    }

    // Step 4: Sort all records by creation time
    allRecords.sort((a, b) => {
      const dateA =
        typeof a.created_at === "string"
          ? new Date(a.created_at).getTime()
          : a.created_at.getTime();
      const dateB =
        typeof b.created_at === "string"
          ? new Date(b.created_at).getTime()
          : b.created_at.getTime();
      return dateA - dateB;
    });

    // Step 5: Apply pagination
    let paginatedRecords = allRecords;
    let hasMore = false;

    // Handle negative 'after' parameter
    let actualAfter = after;
    if (after !== undefined && after < 0) {
      // after=-3 means "get the last 3 records"
      actualAfter = totalCount + after - 1;
      if (actualAfter < 0) {
        actualAfter = -1; // Get all from start
      }
    }

    // Apply 'after' filter
    if (actualAfter !== undefined && actualAfter >= 0) {
      // Skip records up to 'after' index
      paginatedRecords = paginatedRecords.slice(actualAfter + 1);
    }

    // Apply limit
    if (paginatedRecords.length > limit) {
      hasMore = true;
      paginatedRecords = paginatedRecords.slice(0, limit);
    }

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
