/**
 * Delete a stream and all its records
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { createError } from "../../utils/errors.js";
import { createLogger } from "../../logger.js";
import { cacheInvalidation, getCache, cacheKeys } from "../../cache/index.js";
import { createSchema } from "@tinqerjs/tinqer";
import { executeSelect, executeDelete } from "@tinqerjs/pg-promise-adapter";
import type { DatabaseSchema } from "../../db/schema.js";

const logger = createLogger("webpods:domain:streams");
const schema = createSchema<DatabaseSchema>();

export async function deleteStream(
  ctx: DataContext,
  podName: string,
  streamId: number,
  userId: string,
): Promise<Result<void>> {
  // Cannot delete system streams
  // TODO: Update isSystemStream to work with IDs
  // For now, skip this check since we're using stream IDs

  try {
    return await ctx.db.tx(async (t) => {
      // Get the stream by ID
      const streamResults = await executeSelect(
        t,
        schema,
        (q, p) =>
          q
            .from("stream")
            .where((s) => s.id === p.streamId && s.pod_name === p.pod_name)
            .take(1),
        { streamId, pod_name: podName },
      );

      const stream = streamResults[0] || null;

      if (!stream) {
        return failure(createError("NOT_FOUND", "Stream not found"));
      }

      // Only the creator can delete a stream
      if (stream.user_id !== userId) {
        return failure(
          createError("FORBIDDEN", "Only the creator can delete a stream"),
        );
      }

      // Check if stream has child streams
      const childStreams = await executeSelect(
        t,
        schema,
        (q, p) =>
          q
            .from("stream")
            .where(
              (s) => s.pod_name === p.podName && s.parent_id === p.streamId,
            )
            .select((s) => ({ id: s.id })),
        { podName, streamId },
      );

      if (childStreams.length > 0) {
        // Note: The CASCADE will delete them, but we log this for clarity
        logger.info("Deleting stream with child streams", {
          podName,
          streamId,
          childCount: childStreams.length,
        });
      }

      // Delete all records in the stream
      // Note: Child streams and their records will be CASCADE deleted by PostgreSQL
      await executeDelete(
        t,
        schema,
        (q, p) =>
          q.deleteFrom("record").where((r) => r.stream_id === p.streamId),
        { streamId },
      );

      // Delete the stream (CASCADE will delete child streams)
      await executeDelete(
        t,
        schema,
        (q, p) =>
          q
            .deleteFrom("stream")
            .where((s) => s.id === p.streamId && s.pod_name === p.pod_name),
        { streamId, pod_name: podName },
      );

      logger.info("Stream and all children deleted", {
        podName,
        streamId,
      });

      // Invalidate caches for the deleted stream and its children
      // Note: Child streams are CASCADE deleted, so we rely on the pod-level invalidation
      await cacheInvalidation.invalidateStream(podName, stream.path);

      // Invalidate parent's child stream list cache
      const cache = getCache();
      if (cache && stream.parent_id) {
        await cache.delete(
          "streams",
          cacheKeys.streamChildren(podName, stream.parent_id),
        );
        await cache.delete(
          "streams",
          cacheKeys.streamChildrenCount(podName, stream.parent_id),
        );
      }
      // If this was a root stream, invalidate the root children cache
      if (!stream.parent_id && cache) {
        await cache.delete("streams", cacheKeys.streamChildren(podName, null));
        await cache.delete(
          "streams",
          cacheKeys.streamChildrenCount(podName, null),
        );
      }

      return success(undefined);
    });
  } catch (error: unknown) {
    logger.error("Failed to delete stream", { error, podName, streamId });
    return failure(new Error("Failed to delete stream"));
  }
}
