/**
 * Update stream access permission
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { createError } from "../../utils/errors.js";
import { createLogger } from "../../logger.js";
import { cacheInvalidation, getCache, cacheKeys } from "../../cache/index.js";
import { createSchema } from "@webpods/tinqer";
import { executeSelect, executeUpdate } from "@webpods/tinqer-sql-pg-promise";
import type { DatabaseSchema } from "../../db/schema.js";

const logger = createLogger("webpods:domain:streams");
const schema = createSchema<DatabaseSchema>();

export async function updateStreamPermission(
  ctx: DataContext,
  streamId: number,
  accessPermission: string,
): Promise<Result<{ updated: boolean }>> {
  try {
    // Valid access permissions are: public, private, or a path to a permission stream
    if (!accessPermission) {
      return failure(
        createError("INVALID_PERMISSION", "Access permission is required"),
      );
    }

    // Update the stream's access permission
    const now = Date.now();
    const rowsAffected = await executeUpdate(
      ctx.db,
      schema,
      (q, p) =>
        q
          .update("stream")
          .set({
            access_permission: p.accessPermission,
            updated_at: p.updatedAt,
          })
          .where((s) => s.id === p.streamId),
      { streamId, accessPermission, updatedAt: now },
    );

    if (rowsAffected === 0) {
      return failure(createError("STREAM_NOT_FOUND", "Stream not found"));
    }

    // Get stream info for cache invalidation
    const streamInfo = await executeSelect(
      ctx.db,
      schema,
      (q, p) =>
        q
          .from("stream")
          .where((s) => s.id === p.streamId)
          .select((s) => ({ pod_name: s.pod_name, path: s.path })),
      { streamId },
    );

    const updated = streamInfo[0] || null;

    if (updated) {
      logger.debug("Updated stream permission", {
        streamId,
        accessPermission,
        podName: updated.pod_name,
      });

      // Invalidate stream cache since permission changed
      await cacheInvalidation.invalidateStream(updated.pod_name, updated.path);

      // Also invalidate the streamById cache entry
      const cache = getCache();
      if (cache) {
        await cache.delete("streams", cacheKeys.streamById(streamId));
      }
    }

    return success({ updated: true });
  } catch (error: unknown) {
    logger.error("Failed to update stream permission", { error, streamId });
    return failure(
      createError("DATABASE_ERROR", "Failed to update stream permission"),
    );
  }
}
