/**
 * Get a stream by pod name and stream ID
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
    pod_name: row.pod_name,
    name: row.name,
    user_id: row.user_id,
    access_permission: row.access_permission,
    metadata: row.metadata,
    created_at: row.created_at,
    updated_at: row.updated_at || row.created_at,
  };
}

export async function getStream(
  ctx: DataContext,
  podName: string,
  streamId: string,
): Promise<Result<Stream>> {
  try {
    const stream = await ctx.db.oneOrNone<StreamDbRow>(
      `SELECT * FROM stream
       WHERE pod_name = $(pod_name)
         AND name = $(name)`,
      { pod_name: podName, name: streamId },
    );

    if (!stream) {
      return failure(createError("STREAM_NOT_FOUND", "Stream not found"));
    }

    return success(mapStreamFromDb(stream));
  } catch (error: any) {
    logger.error("Failed to get stream", { error, podName, streamId });
    return failure(createError("DATABASE_ERROR", "Failed to get stream"));
  }
}
