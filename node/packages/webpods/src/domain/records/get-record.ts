/**
 * Get a record by name
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { StreamRecord } from "../../types.js";
import { createLogger } from "../../logger.js";
import { createError } from "../../utils/errors.js";
import { getCache, cacheKeys } from "../../cache/index.js";
import { getConfig } from "../../config-loader.js";
import { createSchema } from "@webpods/tinqer";
import { executeSelect } from "@webpods/tinqer-sql-pg-promise";
import type { DatabaseSchema } from "../../db/schema.js";

const logger = createLogger("webpods:domain:records");
const schema = createSchema<DatabaseSchema>();

/**
 * Map database row to domain type
 */
function mapRecordFromDb(row: DatabaseSchema["record"]): StreamRecord {
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

export async function getRecord(
  ctx: DataContext,
  podName: string,
  streamId: number,
  name: string,
  streamPath?: string,
): Promise<Result<StreamRecord>> {
  try {
    const cache = getCache();
    const config = getConfig();
    let record: DatabaseSchema["record"] | null = null;

    // Check cache first
    if (cache && config.cache?.pools?.singleRecords?.enabled && streamPath) {
      const cacheKey = cacheKeys.recordData(podName, streamPath, name);
      const cachedRecord = await cache.get<StreamRecord>(
        "singleRecords",
        cacheKey,
      );
      if (cachedRecord) {
        logger.debug("Record cache hit", { streamId, name });
        return success(cachedRecord);
      }
      logger.debug("Record cache miss", { streamId, name });
    }

    // Get the latest record by name using Tinqer
    const latestRecords = await executeSelect(
      ctx.db,
      schema,
      (q, p) =>
        q
          .from("record")
          .where((r) => r.stream_id === p.streamId && r.name === p.name)
          .orderByDescending((r) => r.index)
          .take(1),
      { streamId, name },
    );

    const latestRecord = latestRecords[0] || null;

    // Only use it if it's not deleted or purged
    if (latestRecord && !latestRecord.deleted && !latestRecord.purged) {
      record = latestRecord;
    }

    if (!record) {
      return failure(createError("RECORD_NOT_FOUND", "Record not found"));
    }

    const mappedRecord = mapRecordFromDb(record);

    // Cache the record
    if (cache && config.cache?.pools?.singleRecords?.enabled && streamPath) {
      // Use the record's size field directly to avoid JSON.stringify
      const size = mappedRecord.size;
      if (size <= config.cache.pools.singleRecords.maxRecordSizeBytes) {
        const cacheKey = cacheKeys.recordData(podName, streamPath, name);
        const ttl = config.cache.pools.singleRecords.ttlSeconds;
        // Pass approximate cache size: record size + overhead for metadata fields
        const cacheSize = size + 200; // Add ~200 bytes for metadata fields
        await cache.set(
          "singleRecords",
          cacheKey,
          mappedRecord,
          ttl,
          cacheSize,
        );
        logger.debug("Record cached", {
          streamId,
          name,
          size,
          ttl,
        });
      } else {
        logger.debug("Record too large to cache", {
          streamId,
          name,
          size,
        });
      }
    }

    return success(mappedRecord);
  } catch (error: unknown) {
    logger.error("Failed to get record", { error, podName, streamId, name });
    return failure(createError("INTERNAL_ERROR", "Failed to get record"));
  }
}
