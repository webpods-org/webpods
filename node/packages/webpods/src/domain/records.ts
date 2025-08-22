/**
 * Record operations domain logic
 */

import { Database } from "../db.js";
import { RecordDbRow } from "../db-types.js";
import { StreamRecord, Result, StreamRecordResponse } from "../types.js";
import { calculateRecordHash, isValidName, isNumericIndex } from "../utils.js";
import { createLogger } from "../logger.js";

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

/**
 * Write a record to a stream
 */
export async function writeRecord(
  db: Database,
  streamId: string,
  content: any,
  contentType: string,
  authorId: string,
  name: string,
): Promise<Result<StreamRecord>> {
  // Validate name (required)
  if (!isValidName(name)) {
    return {
      success: false,
      error: {
        code: "INVALID_NAME",
        message:
          "Name can only contain letters, numbers, hyphens, underscores, and periods. Cannot start or end with a period.",
      },
    };
  }

  try {
    return await db.tx(async (t) => {
      // Get the previous record for hash chain
      const previousRecord = await t.oneOrNone<RecordDbRow>(
        `SELECT * FROM record 
         WHERE stream_id = $(streamId)
         ORDER BY index DESC
         LIMIT 1`,
        { streamId },
      );

      const index = (previousRecord?.index ?? -1) + 1;
      const previousHash = previousRecord?.hash || null;
      const timestamp = new Date().toISOString();

      // Calculate hash
      const hash = calculateRecordHash(previousHash, timestamp, content);

      // Prepare content for storage
      let storedContent = content;
      if (typeof content === "object" && contentType === "application/json") {
        storedContent = JSON.stringify(content);
      }

      // Insert new record
      const record = await t.one<RecordDbRow>(
        `INSERT INTO record (stream_id, index, content, content_type, name, hash, previous_hash, user_id, created_at)
         VALUES ($(streamId), $(index), $(content), $(contentType), $(name), $(hash), $(previousHash), $(authorId), $(timestamp))
         RETURNING *`,
        {
          streamId,
          index,
          content: storedContent,
          contentType,
          name,
          hash,
          previousHash,
          authorId,
          timestamp,
        },
      );

      logger.info("Record written", { streamId, index, name, hash });
      return { success: true, data: mapRecordFromDb(record) };
    });
  } catch (error: any) {
    logger.error("Failed to write record", { error, streamId });
    return {
      success: false,
      error: {
        code: "DATABASE_ERROR",
        message: "Failed to write record",
      },
    };
  }
}

/**
 * Get a record by index or alias
 */
export async function getRecord(
  db: Database,
  streamId: string,
  target: string,
  preferName: boolean = false,
): Promise<Result<StreamRecord>> {
  try {
    let record: RecordDbRow | null = null;

    // If preferName is true, try name first even if target is numeric
    if (preferName) {
      // Try to get by name first - get the latest record with this name
      record = await db.oneOrNone<RecordDbRow>(
        `SELECT * FROM record
         WHERE stream_id = $(streamId)
           AND name = $(name)
         ORDER BY index DESC
         LIMIT 1`,
        { streamId, name: target },
      );

      // If not found as name and target is numeric, try as index
      if (!record && isNumericIndex(target)) {
        let index = parseInt(target);

        // Handle negative indexing
        if (index < 0) {
          const countResult = await db.one<{ count: string }>(
            `SELECT COUNT(*) as count FROM record WHERE stream_id = $(streamId)`,
            { streamId },
          );

          index = parseInt(countResult.count) + index;

          if (index < 0) {
            return {
              success: false,
              error: {
                code: "INVALID_INDEX",
                message: "Index out of range",
              },
            };
          }
        }

        record = await db.oneOrNone<RecordDbRow>(
          `SELECT * FROM record
           WHERE stream_id = $(streamId)
             AND index = $(index)`,
          { streamId, index },
        );
      }
    } else {
      // Default behavior: check if target is numeric (index)
      if (isNumericIndex(target)) {
        let index = parseInt(target);

        // Handle negative indexing
        if (index < 0) {
          const countResult = await db.one<{ count: string }>(
            `SELECT COUNT(*) as count FROM record WHERE stream_id = $(streamId)`,
            { streamId },
          );

          index = parseInt(countResult.count) + index;

          if (index < 0) {
            return {
              success: false,
              error: {
                code: "INVALID_INDEX",
                message: "Index out of range",
              },
            };
          }
        }

        record = await db.oneOrNone<RecordDbRow>(
          `SELECT * FROM record
           WHERE stream_id = $(streamId)
             AND index = $(index)`,
          { streamId, index },
        );
      } else {
        // Get by name - get the latest record with this name
        record = await db.oneOrNone<RecordDbRow>(
          `SELECT * FROM record
           WHERE stream_id = $(streamId)
             AND name = $(name)
           ORDER BY index DESC
           LIMIT 1`,
          { streamId, name: target },
        );
      }
    }

    if (!record) {
      return {
        success: false,
        error: {
          code: "RECORD_NOT_FOUND",
          message: "Record not found",
        },
      };
    }

    return { success: true, data: mapRecordFromDb(record) };
  } catch (error: any) {
    logger.error("Failed to get record", { error, streamId, target });
    return {
      success: false,
      error: {
        code: "DATABASE_ERROR",
        message: "Failed to get record",
      },
    };
  }
}

/**
 * Get a range of records
 */
export async function getRecordRange(
  db: Database,
  streamId: string,
  start: number,
  end: number,
): Promise<Result<StreamRecord[]>> {
  try {
    // Get total count for negative index handling
    const countResult = await db.one<{ count: string }>(
      `SELECT COUNT(*) as count FROM record WHERE stream_id = $(streamId)`,
      { streamId },
    );

    const total = parseInt(countResult.count);

    // Handle negative indices
    if (start < 0) start = total + start;
    if (end < 0) end = total + end;

    // Validate range
    if (start < 0 || end < 0 || start > end) {
      return {
        success: false,
        error: {
          code: "INVALID_RANGE",
          message: "Invalid range specified",
        },
      };
    }

    const records = await db.manyOrNone<RecordDbRow>(
      `SELECT * FROM record
       WHERE stream_id = $(streamId)
         AND index >= $(start)
         AND index < $(end)
       ORDER BY index ASC`,
      { streamId, start, end },
    );

    return { success: true, data: records.map(mapRecordFromDb) };
  } catch (error: any) {
    logger.error("Failed to get record range", { error, streamId, start, end });
    return {
      success: false,
      error: {
        code: "DATABASE_ERROR",
        message: "Failed to get record range",
      },
    };
  }
}

/**
 * List records in a stream
 */
export async function listRecords(
  db: Database,
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

    const records = await db.manyOrNone<RecordDbRow>(query, params);

    const countResult = await db.one<{ count: string }>(
      `SELECT COUNT(*) as count FROM record WHERE stream_id = $(streamId)`,
      { streamId },
    );

    const total = parseInt(countResult.count);
    const hasMore = records.length > limit;

    if (hasMore) {
      records.pop(); // Remove the extra record
    }

    return {
      success: true,
      data: {
        records: records.map(mapRecordFromDb),
        total,
        hasMore,
      },
    };
  } catch (error: any) {
    logger.error("Failed to list records", { error, streamId });
    return {
      success: false,
      error: {
        code: "DATABASE_ERROR",
        message: "Failed to list records",
      },
    };
  }
}

/**
 * List unique named records (latest version per name, excluding deleted)
 */
export async function listUniqueRecords(
  db: Database,
  streamId: string,
  limit: number = 100,
  after?: number,
): Promise<
  Result<{ records: StreamRecord[]; total: number; hasMore: boolean }>
> {
  try {
    // Get all records with names, ordered by index
    const allRecords = await db.manyOrNone<RecordDbRow>(
      `SELECT * FROM record 
       WHERE stream_id = $(streamId) 
       AND name IS NOT NULL
       ORDER BY index ASC`,
      { streamId },
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

    // Convert map to array and sort by index ascending (same as regular list)
    let uniqueRecords = Array.from(latestByName.values()).sort(
      (a, b) => a.index - b.index,
    );

    // Apply pagination
    if (after !== undefined) {
      uniqueRecords = uniqueRecords.filter((r) => r.index > after);
    }

    const total = latestByName.size;
    const hasMore = uniqueRecords.length > limit;

    if (hasMore) {
      uniqueRecords = uniqueRecords.slice(0, limit);
    }

    return {
      success: true,
      data: {
        records: uniqueRecords.map(mapRecordFromDb),
        total,
        hasMore,
      },
    };
  } catch (error: any) {
    logger.error("Failed to list unique records", { error, streamId });
    return {
      success: false,
      error: {
        code: "DATABASE_ERROR",
        message: "Failed to list unique records",
      },
    };
  }
}

/**
 * Convert record to API response format
 */
export function recordToResponse(record: StreamRecord): StreamRecordResponse {
  let content = record.content;

  // Parse JSON content if needed
  if (
    record.content_type === "application/json" &&
    typeof content === "string"
  ) {
    try {
      content = JSON.parse(content);
    } catch {
      // Keep as string if parse fails
    }
  }

  return {
    index: record.index,
    content: content,
    content_type: record.content_type,
    name: record.name,
    hash: record.hash,
    previous_hash: record.previous_hash,
    author: record.user_id,
    timestamp: record.created_at.toISOString(),
  };
}
