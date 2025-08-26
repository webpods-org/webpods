/**
 * List unique records (latest version of each named record)
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
    podName: row.pod_name,
    streamName: row.stream_name,
    index: row.index,
    content: row.content,
    contentType: row.content_type,
    name: row.name || "",
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

export async function listUniqueRecords(
  ctx: DataContext,
  podName: string,
  streamId: string,
  limit: number = 100,
  after?: number,
): Promise<
  Result<{ records: StreamRecord[]; total: number; hasMore: boolean }>
> {
  try {
    // Get all records with names, ordered by index
    const allRecords = await ctx.db.manyOrNone<RecordDbRow>(
      `SELECT * FROM record
       WHERE pod_name = $(pod_name)
         AND stream_name = $(stream_name)
         AND name IS NOT NULL
       ORDER BY index ASC`,
      { pod_name: podName, stream_name: streamId },
    );

    // Build map of latest record per name, excluding deleted
    const latestByName = new Map<string, RecordDbRow>();

    for (const record of allRecords) {
      // Check if record is deleted/purged
      let isDeleted = false;
      if (record.content_type === "application/json") {
        try {
          const content = JSON.parse(record.content);
          if (
            content &&
            typeof content === "object" &&
            (content.deleted === true || content.purged === true)
          ) {
            isDeleted = true;
          }
        } catch {
          // Not valid JSON, treat as normal record
        }
      }

      if (isDeleted) {
        // Remove this name from the map if it exists
        latestByName.delete(record.name!);
      } else {
        // Update with this record (latest wins)
        latestByName.set(record.name!, record);
      }
    }

    // Convert map to array and sort by index ascending
    let uniqueRecords = Array.from(latestByName.values()).sort(
      (a, b) => a.index - b.index,
    );

    // Apply pagination
    let actualAfter = after;
    if (after !== undefined && after < 0) {
      // Get total count to convert negative index
      const totalCount = await ctx.db
        .one<{
          count: string;
        }>(
          `SELECT COUNT(*) as count FROM record WHERE pod_name = $(pod_name) AND stream_name = $(stream_name)`,
          { pod_name: podName, stream_name: streamId },
        )
        .then((r) => parseInt(r.count));

      // after=-3 means "get the last 3 records", so we skip totalCount-3 records
      actualAfter = totalCount + after - 1;

      // If still negative, start from beginning
      if (actualAfter < 0) {
        actualAfter = -1;
      }
    }

    if (actualAfter !== undefined) {
      uniqueRecords = uniqueRecords.filter((r) => r.index > actualAfter);
    }

    const total = latestByName.size;
    const hasMore = uniqueRecords.length > limit;

    if (hasMore) {
      uniqueRecords = uniqueRecords.slice(0, limit);
    }

    return success({
      records: uniqueRecords.map(mapRecordFromDb),
      total,
      hasMore,
    });
  } catch (error: any) {
    logger.error("Failed to list unique records", {
      error,
      podName,
      streamId,
      limit,
      after,
    });
    return failure(new Error("Failed to list unique records"));
  }
}
