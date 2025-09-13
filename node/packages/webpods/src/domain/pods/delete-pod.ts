/**
 * Delete a pod and all its data
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { createError } from "../../utils/errors.js";
import { PodDbRow, RecordDbRow } from "../../db-types.js";
import { createLogger } from "../../logger.js";
import { cacheInvalidation, getCache } from "../../cache/index.js";

const logger = createLogger("webpods:domain:pods");

export async function deletePod(
  ctx: DataContext,
  podName: string,
  userId: string,
): Promise<Result<void>> {
  try {
    return await ctx.db.tx(async (t) => {
      // Verify the pod exists
      const pod = await t.oneOrNone<PodDbRow>(
        `SELECT * FROM pod WHERE name = $(pod_name)`,
        { pod_name: podName },
      );

      if (!pod) {
        return failure(new Error("Pod not found"));
      }

      // Verify ownership using separate queries
      // Get .config stream
      const configStream = await t.oneOrNone<{ id: string }>(
        `SELECT id FROM stream 
         WHERE pod_name = $(pod_name) 
           AND name = '.config' 
           AND parent_id IS NULL`,
        { pod_name: pod.name },
      );

      if (!configStream) {
        return failure(new Error("Config stream not found"));
      }

      // Get owner stream (child of .config)
      const ownerStream = await t.oneOrNone<{ id: string }>(
        `SELECT id FROM stream 
         WHERE parent_id = $(parent_id) 
           AND name = 'owner'`,
        { parent_id: configStream.id },
      );

      if (!ownerStream) {
        return failure(new Error("Owner stream not found"));
      }

      // Get owner record
      const ownerRecord = await t.oneOrNone<RecordDbRow>(
        `SELECT * FROM record 
         WHERE stream_id = $(stream_id)
           AND name = 'owner'
         ORDER BY index DESC
         LIMIT 1`,
        { stream_id: ownerStream.id },
      );

      if (!ownerRecord) {
        return failure(new Error("Owner record not found"));
      }

      try {
        const content = JSON.parse(ownerRecord.content);
        if (content.userId !== userId) {
          return failure(
            createError("FORBIDDEN", "Only the pod owner can delete the pod"),
          );
        }
      } catch {
        return failure(new Error("Failed to verify ownership"));
      }

      // Delete all records in all streams of this pod
      await t.none(
        `DELETE FROM record
         WHERE stream_id IN (SELECT id FROM stream WHERE pod_name = $(pod_name))`,
        { pod_name: pod.name },
      );

      // Delete all streams
      await t.none(`DELETE FROM stream WHERE pod_name = $(pod_name)`, {
        pod_name: pod.name,
      });

      // Delete the pod
      await t.none(`DELETE FROM pod WHERE name = $(pod_name)`, {
        pod_name: pod.name,
      });

      // Invalidate pod cache and all related caches
      await cacheInvalidation.invalidatePod(pod.name, pod.name);
      
      // Also invalidate user's pod list cache
      const cache = getCache();
      if (cache) {
        await cache.delete("pods", `user-pods:${userId}`);
      }

      logger.info("Pod deleted", { podName });
      return success(undefined);
    });
  } catch (error: unknown) {
    logger.error("Failed to delete pod", { error, podName });
    return failure(new Error("Failed to delete pod"));
  }
}
