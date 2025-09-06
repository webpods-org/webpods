/**
 * Get all streams matching a prefix pattern
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { createError } from "../../utils/errors.js";
import { StreamDbRow } from "../../db-types.js";
import { Stream } from "../../types.js";
import { createLogger } from "../../logger.js";

const logger = createLogger("webpods:domain:streams");

/**
 * Map database row to domain type
 */
function mapStreamFromDb(row: StreamDbRow): Stream {
  return {
    podName: row.pod_name,
    name: row.name,
    userId: row.user_id,
    accessPermission: row.access_permission,
    metadata: row.metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at,
  };
}

/**
 * Get streams that match exactly or start with a prefix
 * For streamName "a/b", this will match:
 * - "a/b" (exact match)
 * - "a/b/c", "a/b/d", etc. (starts with "a/b/")
 */
export async function getStreamsWithPrefix(
  ctx: DataContext,
  podName: string,
  streamName: string,
): Promise<Result<Stream[]>> {
  try {
    // First query: exact match
    const exactStream = await ctx.db.oneOrNone<StreamDbRow>(
      `SELECT * FROM stream 
       WHERE pod_name = $(pod_name) 
         AND name = $(stream_name)`,
      { pod_name: podName, stream_name: streamName },
    );

    // Second query: streams starting with prefix
    const nestedStreams = await ctx.db.manyOrNone<StreamDbRow>(
      `SELECT * FROM stream 
       WHERE pod_name = $(pod_name) 
         AND name LIKE $(prefix)`,
      { pod_name: podName, prefix: `${streamName}/%` },
    );

    const allStreams: StreamDbRow[] = [];

    // Add exact match if it exists
    if (exactStream) {
      allStreams.push(exactStream);
    }

    // Add nested streams
    allStreams.push(...nestedStreams);

    logger.debug("Found streams with prefix", {
      podName,
      streamName,
      count: allStreams.length,
      streams: allStreams.map((s) => s.name),
    });

    return success(allStreams.map(mapStreamFromDb));
  } catch (error: unknown) {
    logger.error("Failed to get streams with prefix", {
      error,
      podName,
      streamName,
    });
    return failure(
      createError("DATABASE_ERROR", "Failed to fetch streams with prefix"),
    );
  }
}
