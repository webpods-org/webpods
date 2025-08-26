/**
 * Write a record to a stream
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { createError } from "../../utils/errors.js";
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

export async function writeRecord(
  ctx: DataContext,
  podName: string,
  streamId: string,
  content: any,
  contentType: string,
  authorId: string,
  name: string,
): Promise<Result<StreamRecord>> {
  // Validate name (required)
  if (!isValidName(name)) {
    return failure(
      createError(
        "INVALID_NAME",
        "Name can only contain letters, numbers, hyphens, underscores, and periods. Cannot start or end with a period.",
      ),
    );
  }

  try {
    return await ctx.db.tx(async (t) => {
      // Get the previous record for hash chain
      const previousRecord = await t.oneOrNone<RecordDbRow>(
        `SELECT * FROM record 
         WHERE pod_name = $(pod_name)
           AND stream_name = $(stream_name)
         ORDER BY index DESC
         LIMIT 1`,
        { pod_name: podName, stream_name: streamId },
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
        pod_name: podName,
        stream_name: streamId,
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

      logger.info("Record written", { podName, streamId, index, name, hash });
      return success(mapRecordFromDb(record));
    });
  } catch (error: any) {
    logger.error("Failed to write record", { error, podName, streamId });
    // Check if it's a unique constraint violation (duplicate name)
    if (
      error.code === "23505" &&
      error.constraint === "record_stream_name_key"
    ) {
      return failure(
        createError("NAME_EXISTS", "Record with this name already exists"),
      );
    }
    return failure(error);
  }
}
