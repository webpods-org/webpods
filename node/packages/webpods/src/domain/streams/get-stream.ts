/**
 * Get a stream by ID or by pod and stream ID
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
    id: row.id,
    pod_id: row.pod_id,
    stream_id: row.stream_id,
    user_id: row.user_id,
    access_permission: row.access_permission,
    metadata: undefined,
    created_at: row.created_at,
    updated_at: row.created_at,
  };
}

export async function getStream(
  ctx: DataContext,
  podId: string,
  streamId: string,
): Promise<Result<Stream>> {
  try {
    const stream = await ctx.db.oneOrNone<StreamDbRow>(
      `SELECT * FROM stream
       WHERE pod_id = $(pod_id)
         AND stream_id = $(stream_id)`,
      { pod_id: podId, stream_id: streamId },
    );

    if (!stream) {
      return failure(createError("STREAM_NOT_FOUND", "Stream not found"));
    }

    return success(mapStreamFromDb(stream));
  } catch (error: any) {
    logger.error("Failed to get stream", { error, podId, streamId });
    return failure(createError("DATABASE_ERROR", "Failed to get stream"));
  }
}
