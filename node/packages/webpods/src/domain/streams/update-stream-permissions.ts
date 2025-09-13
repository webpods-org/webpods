/**
 * Update stream permissions
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { createLogger } from "../../logger.js";
import { sql } from "../../db/index.js";
import { cacheInvalidation } from "../../cache/index.js";
import { StreamDbRow } from "../../db-types.js";

const logger = createLogger("webpods:domain:streams");

export async function updateStreamPermissions(
  ctx: DataContext,
  podName: string,
  streamName: string,
  accessPermission: string,
): Promise<Result<void>> {
  try {
    // Get affected streams before update for cache invalidation
    const affectedStreams = await ctx.db.manyOrNone<StreamDbRow>(
      `SELECT * FROM stream
       WHERE pod_name = $(pod_name)
         AND name = $(name)`,
      { pod_name: podName, name: streamName },
    );

    const params = {
      access_permission: accessPermission,
    };

    await ctx.db.none(
      `${sql.update("stream", params)}
       WHERE pod_name = $(pod_name)
         AND name = $(name)`,
      { ...params, pod_name: podName, name: streamName },
    );

    // Invalidate caches for all affected streams
    for (const stream of affectedStreams) {
      await cacheInvalidation.invalidateStream(stream.id.toString(), podName, stream.path);
    }

    logger.info("Stream permissions updated", {
      podName,
      streamName,
      accessPermission,
      affectedCount: affectedStreams.length,
    });
    return success(undefined);
  } catch (error: unknown) {
    logger.error("Failed to update stream permissions", {
      error,
      podName,
      streamName,
      accessPermission,
    });
    return failure(new Error("Failed to update stream permissions"));
  }
}
