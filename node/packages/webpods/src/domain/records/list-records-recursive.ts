/**
 * List records from multiple streams recursively
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { StreamRecord } from "../../types.js";
import { createLogger } from "../../logger.js";
import { getStreamsWithPrefix } from "../streams/get-streams-with-prefix.js";
import { canRead } from "../permissions/can-read.js";
import { createSchema } from "@webpods/tinqer";
import { executeSelect } from "@webpods/tinqer-sql-pg-promise";
import type { DatabaseSchema } from "../../db/schema.js";

const logger = createLogger("webpods:domain:records");
const schema = createSchema<DatabaseSchema>();

/**
 * Map database row to domain type
 */
function mapRecordFromDb(row: DatabaseSchema["record"]): StreamRecord {
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
    headers: JSON.parse(row.headers),
    metadata: undefined,
    createdAt: row.created_at,
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
    // Note: Including all records, even deletion markers, as this is an append-only log
    const countResult = await executeSelect(
      ctx.db,
      schema,
      (q, p) =>
        q
          .from("record")
          .where((r) => p.streamIds.includes(r.stream_id))
          .count(),
      { streamIds: readableStreamIds },
    );

    const totalCount = Number(countResult);

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
    // Note: Including all records as this is an append-only log
    const records =
      actualAfter !== undefined && actualAfter >= 0
        ? await executeSelect(
            ctx.db,
            schema,
            (q, p) =>
              q
                .from("record")
                .where((r) => p.streamIds.includes(r.stream_id))
                .orderBy((r) => r.created_at)
                .skip(p.offset)
                .take(p.limit)
                .select((r) => r),
            {
              streamIds: readableStreamIds,
              offset: actualAfter,
              limit: limit + 1,
            },
          )
        : await executeSelect(
            ctx.db,
            schema,
            (q, p) =>
              q
                .from("record")
                .where((r) => p.streamIds.includes(r.stream_id))
                .orderBy((r) => r.created_at)
                .take(p.limit)
                .select((r) => r),
            { streamIds: readableStreamIds, limit: limit + 1 },
          );

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
