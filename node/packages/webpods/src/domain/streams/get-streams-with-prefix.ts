/**
 * Get all child streams under a path (recursively)
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { createError } from "../../utils/errors.js";
import { StreamDbRow } from "../../db-types.js";
import { Stream } from "../../types.js";
import { createLogger } from "../../logger.js";
import { getStreamByPath } from "./get-stream-by-path.js";

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
 * Get all child streams under a given path (recursive)
 * For path "/blog", this will return all streams under /blog including nested ones
 */
export async function getStreamsWithPrefix(
  ctx: DataContext,
  podName: string,
  streamPath: string,
): Promise<Result<Stream[]>> {
  try {
    // Get the parent stream
    const parentResult = await getStreamByPath(ctx, podName, streamPath);
    if (!parentResult.success) {
      // If parent doesn't exist, return empty array (no children)
      return success([]);
    }

    const parentStream = parentResult.data;
    const allStreams: Stream[] = [parentStream];

    // Recursive function to get all descendants
    async function getDescendants(parentId: number): Promise<void> {
      const children = await ctx.db.manyOrNone<StreamDbRow>(
        `SELECT * FROM stream 
         WHERE pod_name = $(podName) 
           AND parent_id = $(parentId)`,
        { podName, parentId },
      );

      for (const child of children) {
        const childStream = mapStreamFromDb(child);
        allStreams.push(childStream);
        // Recursively get children of this child
        await getDescendants(child.id);
      }
    }

    // Get all descendants
    await getDescendants(parentStream.id);

    logger.debug("Found streams with prefix", {
      podName,
      streamPath,
      count: allStreams.length,
    });

    return success(allStreams);
  } catch (error: unknown) {
    logger.error("Failed to get streams with prefix", {
      error,
      podName,
      streamPath,
    });
    return failure(
      createError("DATABASE_ERROR", "Failed to fetch streams with prefix"),
    );
  }
}
