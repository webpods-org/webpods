/**
 * Transfer pod ownership to another user
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { createError } from "../../utils/errors.js";
import { calculateContentHash, calculateRecordHash } from "../../utils.js";
import { createLogger } from "../../logger.js";
import { cacheInvalidation, getCache, cacheKeys } from "../../cache/index.js";
import { createSchema } from "@webpods/tinqer";
import {
  executeSelect,
  executeInsert,
  executeUpdate,
} from "@webpods/tinqer-sql-pg-promise";
import type { DatabaseSchema } from "../../db/schema.js";

const logger = createLogger("webpods:domain:pods");
const schema = createSchema<DatabaseSchema>();

export async function transferPodOwnership(
  ctx: DataContext,
  podName: string,
  fromUserId: string,
  toUserId: string,
): Promise<Result<void>> {
  try {
    return await ctx.db.tx(async (t) => {
      // Validate that the new owner exists
      const newOwnerResults = await executeSelect(
        t,
        schema,
        (q, p) =>
          q
            .from("user")
            .select((u) => ({ id: u.id }))
            .where((u) => u.id === p.userId)
            .take(1),
        { userId: toUserId },
      );

      const newOwnerExists = newOwnerResults[0] || null;

      if (!newOwnerExists) {
        return failure(createError("USER_NOT_FOUND", "User not found"));
      }

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
        { pod_name: podName },
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

      // Verify current owner
      const currentOwnerRecordResults = await executeSelect(
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

      const currentOwnerRecord = currentOwnerRecordResults[0] || null;

      if (!currentOwnerRecord) {
        return failure(new Error("Current owner record not found"));
      }

      try {
        const content = JSON.parse(currentOwnerRecord.content);
        if (content.userId !== fromUserId) {
          return failure(
            createError(
              "FORBIDDEN",
              "Only the current owner can transfer ownership",
            ),
          );
        }
      } catch {
        return failure(new Error("Failed to verify current owner"));
      }

      // Get the previous record for hash chain
      const previousRecordResults = await executeSelect(
        t,
        schema,
        (q, p) =>
          q
            .from("record")
            .where((r) => r.stream_id === p.stream_id)
            .select((r) => ({ index: r.index, hash: r.hash }))
            .orderByDescending((r) => r.index)
            .take(1),
        { stream_id: ownerStream.id },
      );

      const previousRecord = previousRecordResults[0] || null;

      const index = (previousRecord?.index ?? -1) + 1;
      const previousHash = previousRecord?.hash || null;
      const timestamp = Date.now();

      // Create new owner record
      const newOwnerContent = { userId: toUserId };
      const contentHash = calculateContentHash(newOwnerContent);
      const hash = calculateRecordHash(
        previousHash,
        contentHash,
        fromUserId,
        timestamp,
      );
      const contentString = JSON.stringify(newOwnerContent);
      const size = Buffer.byteLength(contentString, "utf8");

      // Insert new owner record
      await executeInsert(
        t,
        schema,
        (q, p) =>
          q.insertInto("record").values({
            stream_id: p.stream_id,
            index: p.index,
            content: p.content,
            content_type: p.content_type,
            is_binary: p.is_binary,
            size: p.size,
            name: p.name,
            path: p.path,
            content_hash: p.content_hash,
            hash: p.hash,
            previous_hash: p.previous_hash,
            user_id: p.user_id,
            headers: p.headers,
            deleted: p.deleted,
            purged: p.purged,
            created_at: p.created_at,
          }),
        {
          stream_id: ownerStream.id,
          index: index,
          content: contentString,
          content_type: "application/json",
          is_binary: false,
          size: size,
          name: "owner",
          path: `${ownerStream.path}/owner`,
          content_hash: contentHash,
          hash: hash,
          previous_hash: previousHash,
          user_id: fromUserId,
          headers: JSON.stringify({}),
          deleted: false,
          purged: false,
          created_at: timestamp,
        },
      );

      // Update owner_id in pod table for fast lookups
      await executeUpdate(
        t,
        schema,
        (q, p) =>
          q
            .update("pod")
            .set({ owner_id: p.owner_id, updated_at: p.updated_at })
            .where((pod) => pod.name === p.pod_name),
        {
          owner_id: toUserId,
          pod_name: podName,
          updated_at: Date.now(),
        },
      );

      // Invalidate pod cache since owner has changed
      await cacheInvalidation.invalidatePod(podName);

      // Invalidate both users' pod list caches and pod owner cache
      const cache = getCache();
      if (cache) {
        await cache.delete("pods", cacheKeys.userPods(fromUserId));
        await cache.delete("pods", cacheKeys.userPods(toUserId));
        await cache.delete("pods", cacheKeys.podOwner(podName));
      }

      logger.info("Pod ownership transferred", {
        podName,
        fromUserId,
        toUserId,
      });
      return success(undefined);
    });
  } catch (error: unknown) {
    logger.error("Failed to transfer pod ownership", {
      error,
      podName,
      fromUserId,
      toUserId,
    });
    return failure(new Error("Failed to transfer pod ownership"));
  }
}
