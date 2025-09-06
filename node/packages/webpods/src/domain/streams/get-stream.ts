/**
 * Get a stream by pod name and stream ID
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { createError } from "../../utils/errors.js";
import { StreamDbRow } from "../../db-types.js";
import { Stream } from "../../types.js";
import { createLogger } from "../../logger.js";
import { normalizeStreamName } from "../../utils/stream-utils.js";

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

export async function getStream(
  ctx: DataContext,
  podName: string,
  streamId: string,
): Promise<Result<Stream>> {
  // Normalize stream name to ensure leading slash
  const normalizedStreamId = normalizeStreamName(streamId);

  try {
    const stream = await ctx.db.oneOrNone<StreamDbRow>(
      `SELECT * FROM stream
       WHERE pod_name = $(pod_name)
         AND name = $(name)`,
      { pod_name: podName, name: normalizedStreamId },
    );

    if (!stream) {
      return failure(createError("STREAM_NOT_FOUND", "Stream not found"));
    }

    return success(mapStreamFromDb(stream));
  } catch (error: unknown) {
    logger.error("Failed to get stream", { error, podName, streamId });
    return failure(createError("DATABASE_ERROR", "Failed to get stream"));
  }
}
