/**
 * Resolve a path using .config/routing configuration
 */

import { DataContext } from "../data-context.js";
import { Result, success } from "../../utils/result.js";
import { createLogger } from "../../logger.js";
import { getCache, getCacheConfig, cacheKeys } from "../../cache/index.js";
import { createSchema } from "@webpods/tinqer";
import { executeSelect } from "@webpods/tinqer-sql-pg-promise";
import type { DatabaseSchema } from "../../db/schema.js";

const logger = createLogger("webpods:domain:routing");
const schema = createSchema<DatabaseSchema>();

interface LinkMapping {
  streamPath: string;
  target: string;
}

export async function resolveLink(
  ctx: DataContext,
  podName: string,
  path: string,
): Promise<Result<LinkMapping | null>> {
  try {
    // Check cache first
    const cache = getCache();
    if (cache) {
      const cacheKey = cacheKeys.link(podName, path);
      const cached = await cache.get("pods", cacheKey);
      if (cached !== undefined) {
        logger.debug("Link resolution found in cache", { podName, path });
        return success(cached as LinkMapping | null);
      }
    }

    // Get .config stream
    const configStreamResults = await executeSelect(
      ctx.db,
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
          .select((s) => ({ id: s.id })),
      { pod_name: podName },
    );

    const configStream = configStreamResults[0] || null;

    if (!configStream) {
      return success(null);
    }

    // Get routing stream (child of .config)
    const routingStreamResults = await executeSelect(
      ctx.db,
      schema,
      (q, p) =>
        q
          .from("stream")
          .where((s) => s.parent_id === p.parent_id && s.name === "routing")
          .select((s) => ({ id: s.id })),
      { parent_id: configStream.id },
    );

    const routingStream = routingStreamResults[0] || null;

    if (!routingStream) {
      return success(null);
    }

    // Get the routing record named "routes" (or latest unnamed for backward compatibility)
    const recordResults = await executeSelect(
      ctx.db,
      schema,
      (q, p) =>
        q
          .from("record")
          .where((r) => r.stream_id === p.stream_id && r.name === "routes")
          .orderByDescending((r) => r.created_at)
          .take(1)
          .select((r) => r),
      { stream_id: routingStream.id },
    );

    let record = recordResults[0] || null;

    // Fallback to latest unnamed record for backward compatibility
    if (!record) {
      const unnamedResults = await executeSelect(
        ctx.db,
        schema,
        (q, p) =>
          q
            .from("record")
            .where((r) => r.stream_id === p.stream_id && r.name === null)
            .orderByDescending((r) => r.created_at)
            .take(1)
            .select((r) => r),
        { stream_id: routingStream.id },
      );
      record = unnamedResults[0] || null;
    }

    if (!record) {
      return success(null);
    }

    const links =
      typeof record.content === "string"
        ? JSON.parse(record.content)
        : record.content;

    if (!links[path]) {
      // Cache the null result too
      if (cache) {
        const cacheKey = cacheKeys.link(podName, path);
        const cacheConfig = getCacheConfig();
        const ttl = cacheConfig?.pools?.pods?.ttlSeconds || 300;
        await cache.set("pods", cacheKey, null, ttl);
      }
      return success(null);
    }

    // Parse the mapping (e.g., "homepage/-1", "blog/my-post", or "homepage?i=-1")
    const mapping = links[path];

    // Check if it has query parameters
    let result: LinkMapping;

    if (mapping.includes("?")) {
      // Handle format like "homepage?i=-1"
      const [streamPath, query] = mapping.split("?");
      result = {
        streamPath: streamPath!,
        target: query ? `?${query}` : "",
      };
    } else {
      // Handle format like "homepage/-1" or "homepage/my-post"
      const parts = mapping.split("/");

      if (parts.length === 1) {
        // Just stream name, no target
        result = {
          streamPath: parts[0]!,
          target: "",
        };
      } else {
        // Stream name with record name/index
        const streamPath = parts[0]!;
        const recordTarget = parts.slice(1).join("/");
        result = {
          streamPath,
          target: `/${recordTarget}`,
        };
      }
    }

    // Cache the result
    if (cache) {
      const cacheKey = cacheKeys.link(podName, path);
      const cacheConfig = getCacheConfig();
      const ttl = cacheConfig?.pools?.pods?.ttlSeconds || 300;
      await cache.set("pods", cacheKey, result, ttl);
    }

    return success(result);
  } catch (error: unknown) {
    logger.error("Failed to resolve link", { error, podName, path });
    return success(null);
  }
}
