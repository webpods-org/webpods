/**
 * List all streams in a pod
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { createError } from "../../utils/errors.js";
import { StreamDbRow, PodDbRow } from "../../db-types.js";
import { Stream } from "../../types.js";
import { createLogger } from "../../logger.js";

const logger = createLogger("webpods:domain:pods");

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

export async function listPodStreams(
  ctx: DataContext,
  podName: string,
): Promise<Result<Stream[]>> {
  try {
    const pod = await ctx.db.oneOrNone<PodDbRow>(
      `SELECT * FROM pod WHERE name = $(pod_name)`,
      { pod_name: podName },
    );

    if (!pod) {
      return failure(createError("POD_NOT_FOUND", "Pod not found"));
    }

    const streams = await ctx.db.manyOrNone<StreamDbRow>(
      `SELECT * FROM stream 
       WHERE pod_name = $(pod_name)
       ORDER BY created_at ASC`,
      { pod_name: pod.name },
    );

    return success(streams.map(mapStreamFromDb));
  } catch (error: any) {
    logger.error("Failed to list pod streams", { error, podName });
    return failure(createError("DATABASE_ERROR", "Failed to list streams"));
  }
}
