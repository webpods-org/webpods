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
  after?: number,
): Promise<
  Result<{ records: StreamRecord[]; total: number; hasMore: boolean }>
> {
  try {
    let query = `SELECT * FROM record WHERE stream_id = $(streamId)`;
    const params: any = { streamId, limit: limit + 1 };

    if (after !== undefined) {
      query += ` AND index > $(after)`;
      params.after = after;
    }

    query += ` ORDER BY index ASC LIMIT $(limit)`;

    const records = await ctx.db.manyOrNone<RecordDbRow>(query, params);

    const countResult = await ctx.db.one<{ count: string }>(
      `SELECT COUNT(*) as count FROM record WHERE stream_id = $(streamId)`,
      { streamId },
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
    logger.error("Failed to list records", { error, streamId, limit, after });
    return failure(new Error("Failed to list records"));
  }
}
