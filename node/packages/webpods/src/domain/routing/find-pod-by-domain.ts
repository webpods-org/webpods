/**
 * Find a pod by custom domain
 */

import { DataContext } from "../data-context.js";
import { Result, success } from "../../utils/result.js";
import { PodDbRow, StreamDbRow, RecordDbRow } from "../../db-types.js";
import { createLogger } from "../../logger.js";

const logger = createLogger("webpods:domain:routing");

export async function findPodByDomain(
  ctx: DataContext,
  domain: string,
): Promise<Result<PodDbRow | null>> {
  try {
    // Get all pods that have .meta/domains streams
    const pods = await ctx.db.manyOrNone<PodDbRow>(
      `SELECT DISTINCT p.* FROM pod p
       JOIN stream s ON s.pod_id = p.id
       WHERE s.stream_id = '.meta/domains'`,
    );

    // Check each pod's domains
    for (const pod of pods) {
      const domainStream = await ctx.db.one<StreamDbRow>(
        `SELECT * FROM stream
         WHERE pod_id = $(pod_id)
           AND stream_id = '.meta/domains'`,
        { pod_id: pod.id },
      );

      const records = await ctx.db.manyOrNone<RecordDbRow>(
        `SELECT * FROM record
         WHERE stream_id = $(stream_id)
         ORDER BY index ASC`,
        { stream_id: domainStream.id },
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
        return success(pod);
      }
    }

    return success(null);
  } catch (error) {
    logger.error("Failed to find pod by domain", { error, domain });
    return success(null);
  }
}
