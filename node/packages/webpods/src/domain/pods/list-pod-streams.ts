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
 * Map database row to domain type with full path
 */
function mapStreamFromDb(row: StreamDbRow, pathMap: Map<number, string>): Stream {
  // Build full path from parent hierarchy
  let fullPath = "/" + row.name;
  if (row.parent_id && pathMap.has(row.parent_id)) {
    const parentPath = pathMap.get(row.parent_id)!;
    fullPath = parentPath === "/" ? "/" + row.name : parentPath + "/" + row.name;
  }
  
  return {
    id: row.id,
    podName: row.pod_name,
    name: fullPath, // Use full path as name for API compatibility
    parentId: row.parent_id || null,
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
       ORDER BY parent_id ASC NULLS FIRST, created_at ASC`,
      { pod_name: pod.name },
    );

    // Build path map to construct full paths
    const pathMap = new Map<number, string>();
    const result: Stream[] = [];
    
    // Process streams in order (parents first due to ORDER BY)
    for (const stream of streams) {
      const mapped = mapStreamFromDb(stream, pathMap);
      pathMap.set(stream.id, mapped.name);
      result.push(mapped);
    }

    return success(result);
  } catch (error: unknown) {
    logger.error("Failed to list pod streams", { error, podName });
    return failure(createError("DATABASE_ERROR", "Failed to list streams"));
  }
}
