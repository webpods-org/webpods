/**
 * Get all child streams under a path (recursively)
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { createError } from "../../utils/errors.js";
import { Stream } from "../../types.js";
import { createLogger } from "../../logger.js";
import { createContext, from } from "@webpods/tinqer";
import { executeSelect } from "@webpods/tinqer-sql-pg-promise";
import type { DatabaseSchema } from "../../db/schema.js";

const logger = createLogger("webpods:domain:streams");
const dbContext = createContext<DatabaseSchema>();

/**
 * Map database row to domain type
 */
function mapStreamFromDb(row: DatabaseSchema["stream"]): Stream {
  return {
    id: row.id,
    podName: row.pod_name,
    name: row.name,
    path: row.path,
    parentId: row.parent_id || null,
    userId: row.user_id,
    accessPermission: row.access_permission,
    metadata: JSON.parse(row.metadata),
    hasSchema: row.has_schema,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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
    // Use efficient path-based query to get all matching streams in one query
    // This matches the exact path and all nested paths
    const pathPattern = streamPath.endsWith("/")
      ? `${streamPath}%`
      : `${streamPath}/%`;

    const streams = await executeSelect(
      ctx.db,
      (p: { podName: string; streamPath: string; pathPattern: string }) =>
        from(dbContext, "stream")
          .where(
            (s) =>
              s.pod_name === p.podName &&
              (s.path === p.streamPath || s.path.startsWith(p.pathPattern)),
          )
          .orderBy((s) => s.path)
          .select((s) => s),
      { podName, streamPath, pathPattern },
    );

    const allStreams = streams.map(mapStreamFromDb);

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
