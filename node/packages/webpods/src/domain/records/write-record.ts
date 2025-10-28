/**
 * Write a record to a stream
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { createError } from "../../utils/errors.js";
import { calculateContentHash, calculateRecordHash } from "../../utils.js";
import { createLogger } from "../../logger.js";
import { isValidRecordName } from "../../utils/stream-utils.js";
import {
  getStorageAdapter,
  isExternalStorageEnabled,
} from "../../storage-adapters/index.js";
import { extname } from "path";
import { cacheInvalidation } from "../../cache/index.js";
import { createSchema } from "@tinqerjs/tinqer";
import { executeSelect, executeInsert } from "@tinqerjs/pg-promise-adapter";
import type { DatabaseSchema } from "../../db/schema.js";

const logger = createLogger("webpods:domain:records");
const schema = createSchema<DatabaseSchema>();

export type WriteRecordResult = {
  id: number;
  index: number;
  hash: string;
  previousHash: string | null;
  name: string;
  size: number;
};

export async function writeRecord(
  ctx: DataContext,
  streamId: number,
  content: unknown,
  contentType: string,
  userId: string,
  name: string,
  useExternalStorage?: boolean,
  headers?: Record<string, string>,
): Promise<Result<WriteRecordResult>> {
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
      const existingChildStreamResults = await executeSelect(
        t,
        schema,
        (q, p) =>
          q
            .from("stream")
            .where((s) => s.parent_id === p.streamId && s.name === p.name)
            .take(1),
        { streamId, name },
      );

      const existingChildStream = existingChildStreamResults[0] || null;

      if (existingChildStream) {
        return failure(
          createError(
            "NAME_CONFLICT",
            `A stream named '${name}' already exists as a child of this stream`,
          ),
        );
      }

      // Get the previous record for hash chain
      // No lock needed - UNIQUE constraint on (stream_id, index) prevents conflicts
      const previousRecordResults = await executeSelect(
        t,
        schema,
        (q, p) =>
          q
            .from("record")
            .where((r) => r.stream_id === p.streamId)
            .orderByDescending((r) => r.index)
            .select((r) => ({ index: r.index, hash: r.hash }))
            .take(1),
        { streamId },
      );

      const previousRecord = previousRecordResults[0] || null;

      const index = (previousRecord?.index ?? -1) + 1;
      const previousHash = previousRecord?.hash || null;
      const now = Date.now();

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
      const hash = calculateRecordHash(previousHash, contentHash, userId, now);

      // Get stream path to compute record path
      const streamResults = await executeSelect(
        t,
        schema,
        (q, p) =>
          q
            .from("stream")
            .where((s) => s.id === p.streamId)
            .select((s) => ({ path: s.path }))
            .take(1),
        { streamId },
      );

      const stream = streamResults[0]!;
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
          const podInfoResults = await executeSelect(
            t,
            schema,
            (q, p) =>
              q
                .from("stream")
                .where((s) => s.id === p.streamId)
                .select((s) => ({ pod_name: s.pod_name }))
                .take(1),
            { streamId },
          );
          const podInfo = podInfoResults[0]!;

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
      const recordResults = await executeInsert(
        t,
        schema,
        (q, p) =>
          q
            .insertInto("record")
            .values({
              stream_id: p.streamId,
              index: p.index,
              content: p.content,
              content_type: p.contentType,
              is_binary: p.isBinary,
              size: p.size,
              name: p.name,
              path: p.path,
              content_hash: p.contentHash,
              hash: p.hash,
              previous_hash: p.previousHash,
              user_id: p.userId,
              storage: p.storage,
              headers: p.headers,
              deleted: p.deleted,
              purged: p.purged,
              created_at: p.createdAt,
            })
            .returning((r) => r),
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
          headers: JSON.stringify(headers || {}),
          deleted: false,
          purged: false,
          createdAt: now,
        },
      );

      const record = recordResults[0];
      if (!record) {
        return failure(createError("INSERT_FAILED", "Failed to insert record"));
      }

      logger.info("Record written", {
        streamId,
        index,
        name,
        hash,
      });

      // Get stream info for cache invalidation
      const streamInfoResults = await executeSelect(
        t,
        schema,
        (q, p) =>
          q
            .from("stream")
            .where((s) => s.id === p.streamId)
            .select((s) => ({ pod_name: s.pod_name, path: s.path }))
            .take(1),
        { streamId },
      );
      const streamInfo = streamInfoResults[0];
      if (!streamInfo) {
        return failure(createError("STREAM_NOT_FOUND", "Stream not found"));
      }

      // Invalidate caches
      await cacheInvalidation.invalidateRecord(
        streamInfo.pod_name,
        streamInfo.path,
        name,
      );

      // Return minimal metadata - client already knows what was written
      return success({
        id: record.id,
        index,
        hash,
        previousHash,
        name,
        size,
      });
    });
  } catch (error: unknown) {
    logger.error("Failed to write record", { error, streamId });
    // Check if it's a unique constraint violation on (stream_id, index)
    if ((error as { code?: string }).code === "23505") {
      return failure(
        createError(
          "CONCURRENT_WRITE_CONFLICT",
          "Concurrent write detected - another record was written at the same time. Please retry.",
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
