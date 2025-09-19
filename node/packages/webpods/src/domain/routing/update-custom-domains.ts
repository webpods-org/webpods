/**
 * Update custom domains for a pod
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { PodDbRow, StreamDbRow, RecordDbRow } from "../../db-types.js";
import { calculateContentHash, calculateRecordHash } from "../../utils.js";
import { createLogger } from "../../logger.js";
import { sql } from "../../db/index.js";
import { getCache, cacheKeys } from "../../cache/index.js";

const logger = createLogger("webpods:domain:routing");

export async function updateCustomDomains(
  ctx: DataContext,
  podName: string,
  userId: string,
  domains: string[],
): Promise<Result<void>> {
  try {
    return await ctx.db.tx(async (t) => {
      // Get pod
      const pod = await t.oneOrNone<PodDbRow>(
        `SELECT * FROM pod WHERE name = $(pod_name)`,
        { pod_name: podName },
      );

      if (!pod) {
        return failure(new Error("Pod not found"));
      }

      // Verify ownership - first get .config stream
      const configStream = await t.oneOrNone<StreamDbRow>(
        `SELECT * FROM stream 
         WHERE pod_name = $(pod_name) 
           AND name = '.config' 
           AND parent_id IS NULL`,
        { pod_name: podName },
      );

      if (!configStream) {
        return failure(new Error("Config stream not found"));
      }

      // Get owner stream (child of .config)
      const ownerStream = await t.oneOrNone<StreamDbRow>(
        `SELECT * FROM stream 
         WHERE parent_id = $(parent_id) 
           AND name = 'owner'`,
        { parent_id: configStream.id },
      );

      if (!ownerStream) {
        return failure(new Error("Owner stream not found"));
      }

      // Get owner record
      const ownerRecord = await t.oneOrNone<RecordDbRow>(
        `SELECT * FROM record 
         WHERE stream_id = $(stream_id)
           AND name = 'owner'
         ORDER BY index DESC
         LIMIT 1`,
        { stream_id: ownerStream.id },
      );

      if (!ownerRecord) {
        return failure(new Error("Owner record not found"));
      }

      try {
        const content = JSON.parse(ownerRecord.content);
        if (content.userId !== userId) {
          return failure(
            new Error("Only the pod owner can update custom domains"),
          );
        }
      } catch {
        return failure(new Error("Failed to verify ownership"));
      }

      // Get or create domains stream (child of .config)
      let domainsStream = await t.oneOrNone<StreamDbRow>(
        `SELECT * FROM stream
         WHERE parent_id = $(parent_id)
           AND name = 'domains'`,
        { parent_id: configStream.id },
      );

      // Get old domains for cache invalidation
      let oldDomains: string[] = [];
      if (domainsStream) {
        // Get the most recent domains record to find old domains
        const lastDomainsRecord = await t.oneOrNone<RecordDbRow>(
          `SELECT * FROM record
           WHERE stream_id = $(stream_id)
             AND name = 'domains'
           ORDER BY index DESC
           LIMIT 1`,
          { stream_id: domainsStream.id },
        );

        if (lastDomainsRecord) {
          try {
            const content = JSON.parse(lastDomainsRecord.content);
            oldDomains = content.domains || [];
          } catch {
            // Ignore parse errors
          }
        }
      } else {
        // Create the stream with hierarchical structure
        const now = Date.now();
        const streamParams = {
          pod_name: podName,
          name: "domains",
          path: ".config/domains",
          parent_id: configStream.id,
          user_id: userId,
          access_permission: "private",
          has_schema: false,
          metadata: "{}",
          created_at: now,
          updated_at: now,
        };

        domainsStream = await t.one<StreamDbRow>(
          `${sql.insert("stream", streamParams)} RETURNING *`,
          streamParams,
        );
      }

      // Get the last record for hash chain
      const lastRecord = await t.oneOrNone<Pick<RecordDbRow, "index" | "hash">>(
        `SELECT index, hash FROM record
         WHERE stream_id = $(stream_id)
         ORDER BY index DESC
         LIMIT 1`,
        { stream_id: domainsStream.id },
      );

      const index = (lastRecord?.index ?? -1) + 1;
      const previousHash = lastRecord?.hash || null;

      // Store the complete list of domains in a single record
      const timestamp = Date.now();
      const content = { domains };
      const contentHash = calculateContentHash(content);
      const hash = calculateRecordHash(
        previousHash,
        contentHash,
        userId,
        timestamp,
      );
      const contentString = JSON.stringify(content);
      const size = Buffer.byteLength(contentString, "utf8");

      const params = {
        stream_id: domainsStream.id,
        index: index,
        content: contentString,
        content_type: "application/json",
        is_binary: false,
        size: size,
        name: `domains`,
        path: `.config/domains/domains`,
        content_hash: contentHash,
        hash: hash,
        previous_hash: previousHash,
        user_id: userId,
        headers: JSON.stringify({}),
        deleted: false,
        purged: false,
        created_at: timestamp,
      };

      await t.none(sql.insert("record", params), params);

      // Invalidate cache for all affected domains
      const cache = getCache();
      if (cache) {
        // Invalidate old domains that may no longer point to this pod
        for (const oldDomain of oldDomains) {
          await cache.delete("pods", cacheKeys.domainPod(oldDomain));
        }

        // Invalidate new domains to force fresh lookup
        for (const newDomain of domains) {
          await cache.delete("pods", cacheKeys.domainPod(newDomain));
        }
      }

      logger.info("Custom domains updated", {
        podName,
        domains: domains.length,
      });
      return success(undefined);
    });
  } catch (error: unknown) {
    logger.error("Failed to update custom domains", { error, podName });
    return failure(new Error("Failed to update custom domains"));
  }
}
