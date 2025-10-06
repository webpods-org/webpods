/**
 * Update stream permissions
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { createLogger } from "../../logger.js";
import { cacheInvalidation } from "../../cache/index.js";
import { createSchema } from "@webpods/tinqer";
import { executeSelect, executeUpdate } from "@webpods/tinqer-sql-pg-promise";
import type { DatabaseSchema } from "../../db/schema.js";

const logger = createLogger("webpods:domain:streams");
const schema = createSchema<DatabaseSchema>();

export async function updateStreamPermissions(
  ctx: DataContext,
  podName: string,
  streamName: string,
  accessPermission: string,
): Promise<Result<void>> {
  try {
    // Get affected streams before update for cache invalidation
    const affectedStreams = await executeSelect(
      ctx.db,
      schema,
      (q, p) =>
        q
          .from("stream")
          .where((s) => s.pod_name === p.podName && s.name === p.name)
          .select((s) => ({ path: s.path })),
      { podName, name: streamName },
    );

    const now = Date.now();
    await executeUpdate(
      ctx.db,
      schema,
      (q, p) =>
        q
          .update("stream")
          .set({
            access_permission: p.accessPermission,
            updated_at: p.updatedAt,
          })
          .where((s) => s.pod_name === p.podName && s.name === p.name),
      {
        accessPermission,
        updatedAt: now,
        podName,
        name: streamName,
      },
    );

    // Invalidate caches for all affected streams
    for (const stream of affectedStreams) {
      await cacheInvalidation.invalidateStream(podName, stream.path);
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
