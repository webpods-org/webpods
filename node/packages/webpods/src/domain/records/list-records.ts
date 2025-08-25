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
    stream_id: row.stream_id,
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
  streamId: string,
  limit: number = 100,
  offset: number = 0,
): Promise<Result<StreamRecord[]>> {
  try {
    const records = await ctx.db.manyOrNone<RecordDbRow>(
      `SELECT * FROM record
       WHERE stream_id = $(streamId)
       ORDER BY index ASC
       LIMIT $(limit) OFFSET $(offset)`,
      { streamId, limit, offset },
    );

    return success(records.map(mapRecordFromDb));
  } catch (error: any) {
    logger.error("Failed to list records", { error, streamId, limit, offset });
    return failure(new Error("Failed to list records"));
  }
}