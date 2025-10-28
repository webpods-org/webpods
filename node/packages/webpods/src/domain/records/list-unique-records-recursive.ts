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
import { createSchema } from "@tinqerjs/tinqer";
import { executeSelect } from "@tinqerjs/pg-promise-adapter";
import type { DatabaseSchema } from "../../db/schema.js";

const logger = createLogger("webpods:domain:records");
const schema = createSchema<DatabaseSchema>();

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
    headers: JSON.parse(row.headers),
    metadata: undefined,
    createdAt: row.created_at,
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

    // Step 3: Get total count of unique records using ROW_NUMBER window function
    // For recursive unique, we want the latest record with each name FROM EACH STREAM
    const totalCount = await executeSelect(
      ctx.db,
      schema,
      (q, p, h) =>
        q
          .from("record")
          .where(
            (r) =>
              p.streamIds.includes(r.stream_id) &&
              r.name !== null &&
              r.name !== "",
          )
          .select((r) => ({
            rn: h
              .window(r)
              .partitionBy(
                (row) => row.stream_id,
                (row) => row.name,
              )
              .orderByDescending((row) => row.index)
              .rowNumber(),
          }))
          .where((r) => r.rn === 1)
          .count(),
      { streamIds: readableStreamIds },
    );

    // Handle negative 'after' parameter
    let actualAfter = after;
    if (after !== undefined && after < 0) {
      // after=-3 means "get the last 3 records"
      actualAfter = totalCount + after;
      if (actualAfter < 0) {
        actualAfter = 0; // Get all from start
      }
    }

    // Now get the actual records with pagination using ROW_NUMBER window function
    const actualOffset = actualAfter ?? 0;
    const actualLimit = limit + 1;

    const records = await executeSelect(
      ctx.db,
      schema,
      (q, p, h) =>
        q
          .from("record")
          .where(
            (r) =>
              p.streamIds.includes(r.stream_id) &&
              r.name !== null &&
              r.name !== "",
          )
          .select((r) => ({
            ...r,
            rn: h
              .window(r)
              .partitionBy(
                (row) => row.stream_id,
                (row) => row.name,
              )
              .orderByDescending((row) => row.index)
              .rowNumber(),
          }))
          .where((r) => r.rn === 1)
          .orderBy((r) => r.index)
          .skip(p.offset)
          .take(p.limit),
      {
        streamIds: readableStreamIds,
        limit: actualLimit,
        offset: actualOffset,
      },
    );

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
      error: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
      podName,
      streamPath,
      limit,
      after,
    });
    return failure(
      error instanceof Error
        ? error
        : new Error("Failed to list unique records recursively"),
    );
  }
}
