/**
 * Delete a pod and all its data
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { createError } from "../../utils/errors.js";
import { createLogger } from "../../logger.js";
import { cacheInvalidation, getCache, cacheKeys } from "../../cache/index.js";
import { createSchema } from "@tinqerjs/tinqer";
import { executeSelect, executeDelete } from "@tinqerjs/pg-promise-adapter";
import type { DatabaseSchema } from "../../db/schema.js";

const logger = createLogger("webpods:domain:pods");
const schema = createSchema<DatabaseSchema>();

export async function deletePod(
  ctx: DataContext,
  podName: string,
  userId: string,
): Promise<Result<void>> {
  try {
    return await ctx.db.tx(async (t) => {
      // Verify the pod exists
      const podResults = await executeSelect(
        t,
        schema,
        (q, p) =>
          q
            .from("pod")
            .where((pod) => pod.name === p.pod_name)
            .take(1),
        { pod_name: podName },
      );

      const pod = podResults[0] || null;

      if (!pod) {
        return failure(new Error("Pod not found"));
      }

      // Verify ownership using separate queries
      // Get .config stream
      const configStreamResults = await executeSelect(
        t,
        schema,
        (q, p) =>
          q
            .from("stream")
            .where(
              (s) =>
                s.pod_name === p.pod_name &&
                s.name === ".config" &&
                s.parent_id === null,
            )
            .take(1),
        { pod_name: pod.name },
      );

      const configStream = configStreamResults[0] || null;

      if (!configStream) {
        return failure(new Error("Config stream not found"));
      }

      // Get owner stream (child of .config)
      const ownerStreamResults = await executeSelect(
        t,
        schema,
        (q, p) =>
          q
            .from("stream")
            .where((s) => s.parent_id === p.parent_id && s.name === "owner")
            .take(1),
        { parent_id: configStream.id },
      );

      const ownerStream = ownerStreamResults[0] || null;

      if (!ownerStream) {
        return failure(new Error("Owner stream not found"));
      }

      // Get owner record
      const ownerRecordResults = await executeSelect(
        t,
        schema,
        (q, p) =>
          q
            .from("record")
            .where((r) => r.stream_id === p.stream_id && r.name === "owner")
            .orderByDescending((r) => r.index)
            .take(1),
        { stream_id: ownerStream.id },
      );

      const ownerRecord = ownerRecordResults[0] || null;

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
      // First get all stream IDs for this pod
      const streamIds = await executeSelect(
        t,
        schema,
        (q, p) =>
          q
            .from("stream")
            .where((s) => s.pod_name === p.pod_name)
            .select((s) => ({ id: s.id })),
        { pod_name: pod.name },
      );

      // Delete records for each stream
      if (streamIds.length > 0) {
        for (const stream of streamIds) {
          await executeDelete(
            t,
            schema,
            (q, p) =>
              q.deleteFrom("record").where((r) => r.stream_id === p.streamId),
            { streamId: stream.id },
          );
        }
      }

      // Delete all streams
      await executeDelete(
        t,
        schema,
        (q, p) =>
          q.deleteFrom("stream").where((s) => s.pod_name === p.pod_name),
        { pod_name: pod.name },
      );

      // Delete the pod
      await executeDelete(
        t,
        schema,
        (q, p) => q.deleteFrom("pod").where((pod) => pod.name === p.pod_name),
        { pod_name: pod.name },
      );

      // Invalidate pod cache and all related caches
      await cacheInvalidation.invalidatePod(pod.name);

      // Also invalidate user's pod list cache
      const cache = getCache();
      if (cache) {
        await cache.delete("pods", cacheKeys.userPods(userId));
      }

      logger.info("Pod deleted", { podName });
      return success(undefined);
    });
  } catch (error: unknown) {
    logger.error("Failed to delete pod", { error, podName });
    return failure(new Error("Failed to delete pod"));
  }
}
