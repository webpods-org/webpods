/**
 * Find a pod by custom domain
 */

import { DataContext } from "../data-context.js";
import { Result, success } from "../../utils/result.js";
import { PodDbRow, RecordDbRow } from "../../db-types.js";
import { createLogger } from "../../logger.js";
import { getCache, getCacheConfig } from "../../cache/index.js";

const logger = createLogger("webpods:domain:routing");

export async function findPodByDomain(
  ctx: DataContext,
  domain: string,
): Promise<Result<PodDbRow | null>> {
  try {
    // Check cache first (use pods cache pool for domain mappings)
    const cache = getCache();
    if (cache) {
      const cacheKey = `domain:${domain}`;
      const cached = await cache.get("pods", cacheKey);
      if (cached !== null) {
        logger.debug("Domain mapping found in cache", {
          domain,
          found: !!cached,
        });
        return success(cached as PodDbRow | null);
      }
    }

    // Get all pods
    const pods = await ctx.db.manyOrNone<PodDbRow>(`SELECT * FROM pod`);

    // Check each pod's domains
    for (const pod of pods) {
      // Get .config stream
      const configStream = await ctx.db.oneOrNone<{ id: string }>(
        `SELECT id FROM stream 
         WHERE pod_name = $(pod_name) 
           AND name = '.config' 
           AND parent_id IS NULL`,
        { pod_name: pod.name },
      );

      if (!configStream) continue;

      // Get domains stream (child of .config)
      const domainsStream = await ctx.db.oneOrNone<{ id: string }>(
        `SELECT id FROM stream 
         WHERE parent_id = $(parent_id) 
           AND name = 'domains'`,
        { parent_id: configStream.id },
      );

      if (!domainsStream) continue;

      // Get domain records
      const records = await ctx.db.manyOrNone<RecordDbRow>(
        `SELECT * FROM record
         WHERE stream_id = $(stream_id)
         ORDER BY index ASC`,
        { stream_id: domainsStream.id },
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
          const cacheKey = `domain:${domain}`;
          const cacheConfig = getCacheConfig();
          const ttl = cacheConfig?.pools?.pods?.ttlSeconds || 300;
          await cache.set("pods", cacheKey, pod, ttl);
        }
        return success(pod);
      }
    }

    // No pod found for this domain - cache the negative result too
    if (cache) {
      const cacheKey = `domain:${domain}`;
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
