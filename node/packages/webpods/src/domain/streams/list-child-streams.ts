/**
 * List child streams of a parent stream
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
    podName: row.pod_name,
    name: row.name,
    path: row.path,
    parentId: row.parent_id || null,
    userId: row.user_id,
    accessPermission: row.access_permission,
    metadata: row.metadata,
    hasSchema: row.has_schema || false,
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at,
  };
}

/**
 * List direct child streams of a parent stream
 * @param ctx Data context
 * @param parentId Parent stream ID (null for root streams)
 * @param podName Pod name
 * @returns List of child streams
 */
export async function listChildStreams(
  ctx: DataContext,
  parentId: number | null,
  podName: string,
): Promise<Result<Stream[]>> {
  try {
    const query = parentId
      ? `SELECT * FROM stream
         WHERE pod_name = $(podName)
           AND parent_id = $(parentId)
         ORDER BY name ASC`
      : `SELECT * FROM stream
         WHERE pod_name = $(podName)
           AND parent_id IS NULL
         ORDER BY name ASC`;

    const params = parentId ? { podName, parentId } : { podName };

    const streams = await ctx.db.manyOrNone<StreamDbRow>(query, params);

    logger.debug("Listed child streams", {
      podName,
      parentId,
      count: streams.length,
    });

    return success(streams.map(mapStreamFromDb));
  } catch (error: unknown) {
    logger.error("Failed to list child streams", {
      error,
      podName,
      parentId,
    });
    return failure(
      createError("DATABASE_ERROR", "Failed to list child streams"),
    );
  }
}

/**
 * Count child streams of a parent stream
 * @param ctx Data context
 * @param parentId Parent stream ID (null for root streams)
 * @param podName Pod name
 * @returns Count of child streams
 */
export async function countChildStreams(
  ctx: DataContext,
  parentId: number | null,
  podName: string,
): Promise<Result<number>> {
  try {
    const query = parentId
      ? `SELECT COUNT(*) as count FROM stream
         WHERE pod_name = $(podName)
           AND parent_id = $(parentId)`
      : `SELECT COUNT(*) as count FROM stream
         WHERE pod_name = $(podName)
           AND parent_id IS NULL`;

    const params = parentId ? { podName, parentId } : { podName };

    const result = await ctx.db.one<{ count: string }>(query, params);

    return success(parseInt(result.count));
  } catch (error: unknown) {
    logger.error("Failed to count child streams", {
      error,
      podName,
      parentId,
    });
    return failure(
      createError("DATABASE_ERROR", "Failed to count child streams"),
    );
  }
}
