/**
 * Delete a pod and all its data
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { createError } from "../../utils/errors.js";
import { PodDbRow, RecordDbRow } from "../../db-types.js";
import { createLogger } from "../../logger.js";

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

      // Verify ownership
      const ownerRecord = await t.oneOrNone<RecordDbRow>(
        `SELECT r.* FROM record r
         WHERE r.stream_pod_name = $(pod_name)
           AND r.stream_name = '.meta/owner'
           AND r.name = 'owner'
         ORDER BY r.index DESC
         LIMIT 1`,
        { pod_name: pod.name },
      );

      if (!ownerRecord) {
        return failure(new Error("Owner record not found"));
      }

      try {
        const content = JSON.parse(ownerRecord.content);
        if (content.owner !== userId) {
          return failure(
            createError("FORBIDDEN", "Only the pod owner can delete the pod"),
          );
        }
      } catch {
        return failure(new Error("Failed to verify ownership"));
      }

      // Delete all records in all streams
      await t.none(
        `DELETE FROM record
         WHERE stream_pod_name = $(pod_name)`,
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

      logger.info("Pod deleted", { podName, userId });
      return success(undefined);
    });
  } catch (error: any) {
    logger.error("Failed to delete pod", { error, podName, userId });
    return failure(new Error("Failed to delete pod"));
  }
}
