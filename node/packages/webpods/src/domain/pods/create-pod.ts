/**
 * Create a new pod
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { createError } from "../../utils/errors.js";
import { PodDbRow } from "../../db-types.js";
import { Pod } from "../../types.js";
import {
  isValidPodName,
  calculateContentHash,
  calculateRecordHash,
} from "../../utils.js";
import { createLogger } from "../../logger.js";
import { getCache, cacheKeys } from "../../cache/index.js";
import { createSchema } from "@tinqerjs/tinqer";
import { executeSelect, executeInsert } from "@tinqerjs/pg-promise-adapter";
import type { DatabaseSchema } from "../../db/schema.js";

const logger = createLogger("webpods:domain:pods");
const schema = createSchema<DatabaseSchema>();

/**
 * Map database row to domain type
 */
function mapPodFromDb(row: PodDbRow): Pod {
  return {
    name: row.name,
    userId: "", // Will be populated from .config/owner stream
    metadata: JSON.parse(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createPod(
  ctx: DataContext,
  podName: string,
  userId: string,
): Promise<Result<Pod>> {
  // Validate pod name
  if (!isValidPodName(podName)) {
    return failure(
      createError(
        "INVALID_INPUT",
        "Pod name must be lowercase alphanumeric with hyphens",
      ),
    );
  }

  try {
    return await ctx.db.tx(async (t) => {
      // Check if pod already exists
      const existingResults = await executeSelect(
        t,
        schema,
        (q, p) =>
          q
            .from("pod")
            .where((pod) => pod.name === p.pod_name)
            .take(1),
        { pod_name: podName },
      );

      const existing = existingResults[0] || null;

      if (existing) {
        return failure(createError("POD_EXISTS", "Pod already exists"));
      }

      // Create pod
      const now = Date.now();

      const podResults = await executeInsert(
        t,
        schema,
        (q, p) =>
          q
            .insertInto("pod")
            .values({
              name: p.name,
              owner_id: p.owner_id,
              metadata: p.metadata,
              created_at: p.created_at,
              updated_at: p.updated_at,
            })
            .returning((pod) => pod),
        {
          name: podName,
          owner_id: userId,
          metadata: JSON.stringify({}),
          created_at: now,
          updated_at: now,
        },
      );

      const pod = podResults[0]!;

      // Create .config stream (root level)
      const configStreamResults = await executeInsert(
        t,
        schema,
        (q, p) =>
          q
            .insertInto("stream")
            .values({
              pod_name: p.pod_name,
              name: p.name,
              path: p.path,
              parent_id: p.parent_id,
              user_id: p.user_id,
              access_permission: p.access_permission,
              has_schema: p.has_schema,
              metadata: p.metadata,
              created_at: p.created_at,
              updated_at: p.updated_at,
            })
            .returning((s) => s),
        {
          pod_name: pod.name,
          name: ".config",
          path: ".config",
          parent_id: null,
          user_id: userId,
          access_permission: "private",
          has_schema: false,
          metadata: JSON.stringify({}),
          created_at: now,
          updated_at: now,
        },
      );

      const configStream = configStreamResults[0]!;

      // Create owner stream (child of .config)
      const ownerStreamResults = await executeInsert(
        t,
        schema,
        (q, p) =>
          q
            .insertInto("stream")
            .values({
              pod_name: p.pod_name,
              name: p.name,
              path: p.path,
              parent_id: p.parent_id,
              user_id: p.user_id,
              access_permission: p.access_permission,
              has_schema: p.has_schema,
              metadata: p.metadata,
              created_at: p.created_at,
              updated_at: p.updated_at,
            })
            .returning((s) => s),
        {
          pod_name: pod.name,
          name: "owner",
          path: ".config/owner",
          parent_id: configStream.id,
          user_id: userId,
          access_permission: "private",
          has_schema: false,
          metadata: JSON.stringify({}),
          created_at: now,
          updated_at: now,
        },
      );

      const ownerStream = ownerStreamResults[0]!;

      // Write initial owner record
      const ownerContent = { userId };
      const contentHash = calculateContentHash(ownerContent);
      const hash = calculateRecordHash(null, contentHash, userId, now);
      const contentString = JSON.stringify(ownerContent);
      const size = Buffer.byteLength(contentString, "utf8");

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
          index: 0,
          content: contentString,
          content_type: "application/json",
          is_binary: false,
          size: size,
          name: "owner",
          path: ".config/owner/owner",
          content_hash: contentHash,
          hash: hash,
          previous_hash: null,
          user_id: userId,
          headers: JSON.stringify({}),
          deleted: false,
          purged: false,
          created_at: now,
        },
      );

      // Invalidate user's pod list cache
      const cache = getCache();
      if (cache) {
        await cache.delete("pods", cacheKeys.userPods(userId));
      }

      logger.info("Pod created", { podName });
      const mappedPod = mapPodFromDb(pod);
      mappedPod.userId = userId; // Set owner from what we just wrote
      return success(mappedPod);
    });
  } catch (error: unknown) {
    logger.error("Failed to create pod", { error, podName });
    return failure(createError("INTERNAL_ERROR", "Failed to create pod"));
  }
}
