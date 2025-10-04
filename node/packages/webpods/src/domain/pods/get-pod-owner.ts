/**
 * Get the current owner of a pod
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { createLogger } from "../../logger.js";
import { createError } from "../../utils/errors.js";
import { getCache, getCacheConfig, cacheKeys } from "../../cache/index.js";
import { createContext, from } from "@webpods/tinqer";
import { executeSelect } from "@webpods/tinqer-sql-pg-promise";
import type { DatabaseSchema } from "../../db/schema.js";

const logger = createLogger("webpods:domain:pods");
const dbContext = createContext<DatabaseSchema>();

export async function getPodOwner(
  ctx: DataContext,
  podName: string,
): Promise<Result<string | null>> {
  try {
    // Check cache first
    const cache = getCache();
    if (cache) {
      const cacheKey = cacheKeys.podOwner(podName);
      const cached = await cache.get("pods", cacheKey);
      // cache.get returns undefined for cache misses
      // It can return null if we cached a null value (no owner)
      if (cached !== undefined) {
        logger.debug("Pod owner found in cache", { podName, owner: cached });
        return success(cached as string | null);
      }
    }

    // Get .config stream using Tinqer
    const configStreams = await executeSelect(
      ctx.db,
      (p: { podName: string }) =>
        from(dbContext, "stream")
          .where(
            (s) =>
              s.pod_name === p.podName &&
              s.name === ".config" &&
              s.parent_id === null,
          )
          .select((s) => ({ id: s.id })),
      { podName },
    );

    const configStream = configStreams[0] || null;

    if (!configStream) {
      logger.debug("No .config stream found for pod", { podName });
      // Cache the null result
      if (cache) {
        const cacheKey = cacheKeys.podOwner(podName);
        const cacheConfig = getCacheConfig();
        const ttl = cacheConfig?.pools?.pods?.ttlSeconds || 300;
        await cache.set("pods", cacheKey, null, ttl);
      }
      return success(null);
    }

    // Get owner stream (child of .config) using Tinqer
    const ownerStreams = await executeSelect(
      ctx.db,
      (p: { parentId: number }) =>
        from(dbContext, "stream")
          .where((s) => s.parent_id === p.parentId && s.name === "owner")
          .select((s) => ({ id: s.id })),
      { parentId: configStream.id },
    );

    const ownerStream = ownerStreams[0] || null;

    if (!ownerStream) {
      logger.debug("No owner stream found under .config", {
        podName,
        configStreamId: configStream.id,
      });
      // Cache the null result
      if (cache) {
        const cacheKey = cacheKeys.podOwner(podName);
        const cacheConfig = getCacheConfig();
        const ttl = cacheConfig?.pools?.pods?.ttlSeconds || 300;
        await cache.set("pods", cacheKey, null, ttl);
      }
      return success(null);
    }

    // Get owner record using Tinqer
    const ownerRecords = await executeSelect(
      ctx.db,
      (p: { streamId: number }) =>
        from(dbContext, "record")
          .where((r) => r.stream_id === p.streamId && r.name === "owner")
          .orderByDescending((r) => r.index)
          .take(1)
          .select((r) => r),
      { streamId: ownerStream.id },
    );

    const ownerRecord = ownerRecords[0] || null;

    if (!ownerRecord) {
      logger.debug("No owner record found in owner stream", {
        podName,
        ownerStreamId: ownerStream.id,
      });
      // Cache the null result
      if (cache) {
        const cacheKey = cacheKeys.podOwner(podName);
        const cacheConfig = getCacheConfig();
        const ttl = cacheConfig?.pools?.pods?.ttlSeconds || 300;
        await cache.set("pods", cacheKey, null, ttl);
      }
      return success(null);
    }

    try {
      const content = JSON.parse(ownerRecord.content);
      const ownerId = content.userId || null;

      // Cache the result
      if (cache) {
        const cacheKey = cacheKeys.podOwner(podName);
        const cacheConfig = getCacheConfig();
        const ttl = cacheConfig?.pools?.pods?.ttlSeconds || 300;
        await cache.set("pods", cacheKey, ownerId, ttl);
      }

      return success(ownerId);
    } catch {
      logger.warn("Failed to parse owner record", { podName });
      return success(null);
    }
  } catch (error: unknown) {
    logger.error("Failed to get pod owner", { error, podName });
    return failure(createError("GET_OWNER_ERROR", "Failed to get pod owner"));
  }
}
