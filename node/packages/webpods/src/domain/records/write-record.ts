/**
 * Write a record to a stream
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { createError } from "../../utils/errors.js";
import { RecordDbRow, StreamDbRow } from "../../db-types.js";
import { StreamRecord } from "../../types.js";
import { calculateContentHash, calculateRecordHash } from "../../utils.js";
import { createLogger } from "../../logger.js";
import { isValidRecordName } from "../../utils/stream-utils.js";

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

export async function writeRecord(
  ctx: DataContext,
  streamId: number,
  content: unknown,
  contentType: string,
  userId: string,
  name: string,
): Promise<Result<StreamRecord>> {
  // Validate record name (no slashes allowed)
  if (!isValidRecordName(name)) {
    return failure(
      createError(
        "INVALID_NAME",
        "Record names cannot contain slashes and must follow naming rules",
      ),
    );
  }

  try {
    return await ctx.db.tx(async (t) => {
      // Check if a child stream with the same name exists
      const existingChildStream = await t.oneOrNone<StreamDbRow>(
        `SELECT * FROM stream 
         WHERE parent_id = $(streamId) 
           AND name = $(name)
         LIMIT 1`,
        { streamId, name },
      );

      if (existingChildStream) {
        return failure(
          createError(
            "NAME_CONFLICT",
            `A stream named '${name}' already exists as a child of this stream`,
          ),
        );
      }

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

      // Calculate content hash first
      const contentHash = calculateContentHash(content);

      // Calculate record hash with all parameters
      const hash = calculateRecordHash(
        previousHash,
        contentHash,
        userId,
        timestamp,
      );

      // Prepare content for storage
      let storedContent = content;
      if (typeof content === "object" && contentType === "application/json") {
        storedContent = JSON.stringify(content);
      }

      // Insert new record
      const record = await t.one<RecordDbRow>(
        `INSERT INTO record (stream_id, index, content, content_type, name, content_hash, hash, previous_hash, user_id, created_at)
         VALUES ($(streamId), $(index), $(content), $(contentType), $(name), $(contentHash), $(hash), $(previousHash), $(userId), $(createdAt))
         RETURNING *`,
        {
          streamId,
          index,
          content: storedContent,
          contentType,
          name,
          contentHash,
          hash,
          previousHash,
          userId,
          createdAt: timestamp,
        },
      );

      logger.info("Record written", {
        streamId,
        index,
        name,
        hash,
      });
      return success(mapRecordFromDb(record));
    });
  } catch (error: unknown) {
    logger.error("Failed to write record", { error, streamId });
    // Check if it's a unique constraint violation
    if ((error as { code?: string }).code === "23505") {
      return failure(
        createError(
          "NAME_EXISTS",
          "Record with this name already exists in this stream",
        ),
      );
    }
    return failure(
      createError(
        "WRITE_ERROR",
        (error as Error).message || "Failed to write record",
      ),
    );
  }
}
