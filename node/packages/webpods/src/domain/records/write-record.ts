/**
 * Write a record to a stream
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { RecordDbRow } from "../../db-types.js";
import { StreamRecord } from "../../types.js";
import { calculateRecordHash, isValidName } from "../../utils.js";
import { createLogger } from "../../logger.js";
import { sql } from "../../db/index.js";

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

export async function writeRecord(
  ctx: DataContext,
  streamId: string,
  content: any,
  contentType: string,
  authorId: string,
  name: string,
): Promise<Result<StreamRecord>> {
  // Validate name (required)
  if (!isValidName(name)) {
    return failure(new Error(
      "Name can only contain letters, numbers, hyphens, underscores, and periods. Cannot start or end with a period."
    ));
  }

  try {
    return await ctx.db.tx(async (t) => {
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

      // Insert new record with snake_case parameters
      const params = {
        stream_id: streamId,
        index: index,
        content: storedContent,
        content_type: contentType,
        name: name,
        hash: hash,
        previous_hash: previousHash,
        user_id: authorId,
        created_at: timestamp,
      };

      const record = await t.one<RecordDbRow>(
        `${sql.insert("record", params)} RETURNING *`,
        params,
      );

      logger.info("Record written", { streamId, index, name, hash });
      return success(mapRecordFromDb(record));
    });
  } catch (error: any) {
    logger.error("Failed to write record", { error, streamId });
    return failure(new Error("Failed to write record"));
  }
}