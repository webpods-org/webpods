/**
 * Get a stream by traversing a hierarchical path
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { createError } from "../../utils/errors.js";
import { StreamDbRow } from "../../db-types.js";
import { Stream } from "../../types.js";
import { parseStreamPath } from "../../utils/stream-utils.js";
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
    parentId: row.parent_id || null,
    userId: row.user_id,
    accessPermission: row.access_permission,
    metadata: row.metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at,
  };
}

/**
 * Get a stream by its hierarchical path
 * @param ctx Data context
 * @param podName Pod name
 * @param path Full path like "/blog/posts/2024" or "blog/posts/2024"
 */
export async function getStreamByPath(
  ctx: DataContext,
  podName: string,
  path: string,
): Promise<Result<Stream>> {
  const segments = parseStreamPath(path);

  // Empty path means root
  if (segments.length === 0) {
    return failure(createError("INVALID_PATH", "Cannot get root as stream"));
  }

  try {
    let parentId: number | null = null;
    let currentStream: StreamDbRow | null = null;

    // Traverse the path hierarchy
    for (const segment of segments) {
      const query: string = parentId
        ? `SELECT * FROM stream
           WHERE pod_name = $(podName)
             AND name = $(name)
             AND parent_id = $(parentId)`
        : `SELECT * FROM stream
           WHERE pod_name = $(podName)
             AND name = $(name)
             AND parent_id IS NULL`;

      const params: { podName: string; name: string; parentId?: number } =
        parentId
          ? { podName, name: segment, parentId }
          : { podName, name: segment };

      const stream: StreamDbRow | null = await ctx.db.oneOrNone<StreamDbRow>(
        query,
        params,
      );

      if (!stream) {
        logger.debug("Stream segment not found", {
          podName,
          segment,
          parentId,
          path,
        });
        return failure(
          createError("STREAM_NOT_FOUND", `Stream not found: ${path}`),
        );
      }

      currentStream = stream;
      parentId = stream.id;
    }

    if (!currentStream) {
      return failure(createError("STREAM_NOT_FOUND", "Stream not found"));
    }

    return success(mapStreamFromDb(currentStream));
  } catch (error: unknown) {
    logger.error("Failed to get stream by path", { error, podName, path });
    return failure(createError("DATABASE_ERROR", "Failed to get stream"));
  }
}

/**
 * Build the full path for a stream by traversing up the parent chain
 */
export async function getStreamPath(
  ctx: DataContext,
  streamId: number,
): Promise<Result<string>> {
  try {
    const segments: string[] = [];
    let currentId: number | null = streamId;

    while (currentId) {
      const stream: StreamDbRow | null = await ctx.db.oneOrNone<StreamDbRow>(
        `SELECT * FROM stream WHERE id = $(id)`,
        { id: currentId },
      );

      if (!stream) {
        return failure(createError("STREAM_NOT_FOUND", "Stream not found"));
      }

      segments.unshift(stream.name);
      currentId = stream.parent_id || null;
    }

    return success("/" + segments.join("/"));
  } catch (error: unknown) {
    logger.error("Failed to get stream path", { error, streamId });
    return failure(createError("DATABASE_ERROR", "Failed to get stream path"));
  }
}
