/**
 * Find a pod by custom domain
 */

import { DataContext } from "../data-context.js";
import { Result, success } from "../../utils/result.js";
import { createLogger } from "../../logger.js";
import { getCache, getCacheConfig, cacheKeys } from "../../cache/index.js";
import { createSchema } from "@tinqerjs/tinqer";
import { executeSelect } from "@tinqerjs/pg-promise-adapter";
import type { DatabaseSchema } from "../../db/schema.js";

const logger = createLogger("webpods:domain:routing");
const schema = createSchema<DatabaseSchema>();

export async function findPodByDomain(
  ctx: DataContext,
  domain: string,
): Promise<Result<DatabaseSchema["pod"] | null>> {
  try {
    // Check cache first (use pods cache pool for domain mappings)
    const cache = getCache();
    if (cache) {
      const cacheKey = cacheKeys.domainPod(domain);
      const cached = await cache.get("pods", cacheKey);
      if (cached !== undefined) {
        logger.debug("Domain mapping found in cache", {
          domain,
          found: !!cached,
        });
        return success(cached as DatabaseSchema["pod"] | null);
      }
    }

    // Get all pods using Tinqer
    const pods = await executeSelect(ctx.db, schema, (q) => q.from("pod"), {});

    // Check each pod's domains
    for (const pod of pods) {
      // Get .config stream using Tinqer
      const configStreams = await executeSelect(
        ctx.db,
        schema,
        (q, p) =>
          q
            .from("stream")
            .where(
              (s) =>
                s.pod_name === p.podName &&
                s.name === ".config" &&
                s.parent_id === null,
            )
            .select((s) => ({ id: s.id })),
        { podName: pod.name },
      );

      const configStream = configStreams[0] || null;
      if (!configStream) continue;

      // Get domains stream (child of .config) using Tinqer
      const domainsStreams = await executeSelect(
        ctx.db,
        schema,
        (q, p) =>
          q
            .from("stream")
            .where((s) => s.parent_id === p.parentId && s.name === "domains")
            .select((s) => ({ id: s.id })),
        { parentId: configStream.id },
      );

      const domainsStream = domainsStreams[0] || null;
      if (!domainsStream) continue;

      // Get domain records using Tinqer
      const records = await executeSelect(
        ctx.db,
        schema,
        (q, p) =>
          q
            .from("record")
            .where((r) => r.stream_id === p.streamId)
            .orderBy((r) => r.index),
        { streamId: domainsStream.id },
      );

      // Build current domain list
      const domains = new Set<string>();
      for (const record of records) {
        try {
          const content = JSON.parse(record.content);
          if (content.domain) {
            if (content.action === "remove") {
              domains.delete(content.domain);
            } else {
              domains.add(content.domain);
            }
          }
        } catch {
          // Skip invalid JSON
        }
      }

      if (domains.has(domain)) {
        // Cache the domain->pod mapping
        if (cache) {
          const cacheKey = cacheKeys.domainPod(domain);
          const cacheConfig = getCacheConfig();
          const ttl = cacheConfig?.pools?.pods?.ttlSeconds || 300;
          await cache.set("pods", cacheKey, pod, ttl);
        }
        return success(pod);
      }
    }

    // No pod found for this domain - cache the negative result too
    if (cache) {
      const cacheKey = cacheKeys.domainPod(domain);
      const cacheConfig = getCacheConfig();
      const ttl = cacheConfig?.pools?.pods?.ttlSeconds || 300;
      await cache.set("pods", cacheKey, null, ttl);
    }

    return success(null);
  } catch (error) {
    logger.error("Failed to find pod by domain", { error, domain });
    return success(null);
  }
}
