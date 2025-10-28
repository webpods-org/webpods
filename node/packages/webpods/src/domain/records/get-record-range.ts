/**
 * Get a range of records from a stream
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { RecordDbRow } from "../../db-types.js";
import { StreamRecord } from "../../types.js";
import { createLogger } from "../../logger.js";
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
      const totalCount = await executeSelect(
        ctx.db,
        schema,
        (q, p) =>
          q
            .from("record")
            .where((r) => r.stream_id === p.streamId)
            .count(),
        { streamId },
      );

      if (startIndex < 0) {
        actualStartIndex = totalCount + startIndex;
      }
      if (endIndex < 0) {
        actualEndIndex = totalCount + endIndex;
      } else if (startIndex < 0 && endIndex >= 0) {
        // Special case: negative start with non-negative end
        // This happens for single negative index queries
        // e.g., getRecordRange(-1, 0) should get the last record
        // After conversion: start=4 (for 5 records), end should be 5
        actualEndIndex = actualStartIndex + (endIndex - startIndex);
      }
    }

    // Ensure valid range
    if (actualStartIndex < 0) actualStartIndex = 0;
    if (actualEndIndex < actualStartIndex) {
      return success([]);
    }

    // Fetch records in the specified index range using Tinqer
    // Note: Including all records at these indices, even deletion markers
    const records = await executeSelect(
      ctx.db,
      schema,
      (q, p) =>
        q
          .from("record")
          .where(
            (r) =>
              r.stream_id === p.streamId &&
              r.index >= p.startIndex &&
              r.index < p.endIndex,
          )
          .orderBy((r) => r.index),
      {
        streamId,
        startIndex: actualStartIndex,
        endIndex: actualEndIndex,
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
