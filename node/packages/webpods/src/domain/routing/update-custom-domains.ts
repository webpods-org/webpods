/**
 * Update custom domains for a pod
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { PodDbRow, StreamDbRow, RecordDbRow } from "../../db-types.js";
import { calculateRecordHash } from "../../utils.js";
import { createLogger } from "../../logger.js";
import { sql } from "../../db/index.js";

const logger = createLogger("webpods:domain:routing");

export async function updateCustomDomains(
  ctx: DataContext,
  podName: string,
  userId: string,
  domains: { add?: string[]; remove?: string[] },
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

      // Verify ownership
      const ownerRecord = await t.oneOrNone<RecordDbRow>(
        `SELECT r.* FROM record r
         WHERE r.pod_name = $(pod_name)
           AND r.stream_name = '.meta/owner'
           AND r.name = 'owner'
         ORDER BY r.index DESC
         LIMIT 1`,
        { pod_name: podName },
      );

      if (!ownerRecord) {
        return failure(new Error("Owner record not found"));
      }

      try {
        const content = JSON.parse(ownerRecord.content);
        if (content.owner !== userId) {
          return failure(
            new Error("Only the pod owner can update custom domains"),
          );
        }
      } catch {
        return failure(new Error("Failed to verify ownership"));
      }

      // Get or create .meta/domains stream
      let domainsStream = await t.oneOrNone<StreamDbRow>(
        `SELECT * FROM stream
         WHERE pod_name = $(pod_name)
           AND name = '.meta/domains'`,
        { pod_name: podName },
      );

      if (!domainsStream) {
        // Create the stream with snake_case parameters
        const streamParams = {
          pod_name: podName,
          name: ".meta/domains",
          user_id: userId,
          access_permission: "private",
          created_at: new Date(),
        };

        domainsStream = await t.one<StreamDbRow>(
          `${sql.insert("stream", streamParams)} RETURNING *`,
          streamParams,
        );
      }

      // Get the last record for hash chain
      const lastRecord = await t.oneOrNone<RecordDbRow>(
        `SELECT * FROM record
         WHERE pod_name = $(pod_name)
           AND stream_name = $(stream_name)
         ORDER BY index DESC
         LIMIT 1`,
        { pod_name: podName, stream_name: ".meta/domains" },
      );

      let index = (lastRecord?.index ?? -1) + 1;
      let previousHash = lastRecord?.hash || null;

      // Add domains
      if (domains.add && domains.add.length > 0) {
        for (const domain of domains.add) {
          const timestamp = new Date().toISOString();
          const content = { domain, action: "add" };
          const hash = calculateRecordHash(previousHash, timestamp, content);

          const params = {
            pod_name: podName,
            stream_name: ".meta/domains",
            index: index,
            content: JSON.stringify(content),
            content_type: "application/json",
            name: `domain-${index}`,
            hash: hash,
            previous_hash: previousHash,
            user_id: userId,
            created_at: timestamp,
          };

          await t.none(sql.insert("record", params), params);

          index++;
          previousHash = hash;
        }
      }

      // Remove domains
      if (domains.remove && domains.remove.length > 0) {
        for (const domain of domains.remove) {
          const timestamp = new Date().toISOString();
          const content = { domain, action: "remove" };
          const hash = calculateRecordHash(previousHash, timestamp, content);

          const params = {
            pod_name: podName,
            stream_name: ".meta/domains",
            index: index,
            content: JSON.stringify(content),
            content_type: "application/json",
            name: `domain-${index}`,
            hash: hash,
            previous_hash: previousHash,
            user_id: userId,
            created_at: timestamp,
          };

          await t.none(sql.insert("record", params), params);

          index++;
          previousHash = hash;
        }
      }

      logger.info("Custom domains updated", {
        podName,
        added: domains.add?.length || 0,
        removed: domains.remove?.length || 0,
      });
      return success(undefined);
    });
  } catch (error: unknown) {
    logger.error("Failed to update custom domains", { error, podName });
    return failure(new Error("Failed to update custom domains"));
  }
}
