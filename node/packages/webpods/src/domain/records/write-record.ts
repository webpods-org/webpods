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
import {
  getStorageAdapter,
  isExternalStorageEnabled,
} from "../../storage-adapters/index.js";
import { extname } from "path";
import { cacheInvalidation } from "../../cache/index.js";

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
    isBinary: row.is_binary,
    size: row.size,
    name: row.name,
    path: row.path,
    contentHash: row.content_hash,
    hash: row.hash,
    previousHash: row.previous_hash || null,
    userId: row.user_id,
    storage: row.storage || null,
    headers: row.headers,
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
  useExternalStorage?: boolean,
  headers?: Record<string, string>,
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

      // Detect if content is binary (Buffer) or text (String)
      const isBinary = Buffer.isBuffer(content);

      // Prepare content for storage
      let storedContent: string;
      let size: number;

      if (isBinary) {
        // Binary content: convert to base64 for DB storage
        const buffer = content as Buffer;
        storedContent = buffer.toString("base64");
        size = buffer.byteLength;
      } else if (
        typeof content === "object" &&
        contentType === "application/json"
      ) {
        // JSON object: stringify it
        storedContent = JSON.stringify(content);
        size = Buffer.byteLength(storedContent, "utf8");
      } else {
        // Text content: store as-is (including base64 strings from data URLs)
        storedContent = content as string;
        size = Buffer.byteLength(storedContent, "utf8");
      }

      // Calculate content hash using the prepared content
      const contentHash = calculateContentHash(storedContent);

      // Calculate record hash with all parameters
      const hash = calculateRecordHash(
        previousHash,
        contentHash,
        userId,
        timestamp,
      );

      // Get stream path to compute record path
      const stream = await t.one<StreamDbRow>(
        `SELECT path FROM stream WHERE id = $(streamId)`,
        { streamId },
      );

      const recordPath = `${stream.path}/${name}`;

      // Check if we should store externally
      let storageLocation: string | null = null;
      let dbContent = storedContent;

      // Store externally if:
      // 1. X-Record-Type: file is set (forced external), OR
      // 2. Content is binary (automatic external for all binary)
      if ((useExternalStorage || isBinary) && isExternalStorageEnabled()) {
        const adapter = getStorageAdapter();

        if (adapter) {
          // Get pod name from stream
          const podInfo = await t.one<{ pod_name: string }>(
            `SELECT pod_name FROM stream WHERE id = $(streamId)`,
            { streamId },
          );

          // Extract file extension from name only - don't add one if name has none
          const ext = extname(name).replace(".", "");

          // Convert to Buffer for external storage
          let buffer: Buffer;
          if (isBinary) {
            // Already have the original buffer
            buffer = content as Buffer;
          } else {
            // Text content: convert to UTF-8 buffer
            buffer = Buffer.from(storedContent, "utf8");
          }

          // Store externally
          const storeResult = await adapter.storeFile(
            podInfo.pod_name,
            stream.path,
            name,
            contentHash,
            buffer,
            ext,
          );

          if (storeResult.success) {
            storageLocation = storeResult.data;
            dbContent = ""; // Don't store content in DB
            logger.info("Content stored externally", {
              streamId,
              name,
              size,
              storage: storageLocation,
            });
          } else {
            logger.warn(
              "Failed to store externally, falling back to database",
              {
                error: storeResult.error,
              },
            );
          }
        }
      }

      // Insert new record with path and size
      const record = await t.one<RecordDbRow>(
        `INSERT INTO record (stream_id, index, content, content_type, is_binary, size, name, path, content_hash, hash, previous_hash, user_id, storage, headers, created_at)
         VALUES ($(streamId), $(index), $(content), $(contentType), $(isBinary), $(size), $(name), $(path), $(contentHash), $(hash), $(previousHash), $(userId), $(storage), $(headers), $(createdAt))
         RETURNING *`,
        {
          streamId,
          index,
          content: dbContent,
          contentType,
          isBinary,
          size,
          name,
          path: recordPath,
          contentHash,
          hash,
          previousHash,
          userId,
          storage: storageLocation,
          headers: headers || {},
          createdAt: timestamp,
        },
      );

      logger.info("Record written", {
        streamId,
        index,
        name,
        hash,
      });

      // Invalidate caches
      await cacheInvalidation.invalidateRecord(streamId.toString(), name);

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
