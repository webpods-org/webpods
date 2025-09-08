/**
 * Update custom domains for a pod
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { PodDbRow, StreamDbRow, RecordDbRow } from "../../db-types.js";
import { calculateContentHash, calculateRecordHash } from "../../utils.js";
import { createLogger } from "../../logger.js";
import { sql } from "../../db/index.js";

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

      if (!domainsStream) {
        // Create the stream with hierarchical structure
        const streamParams = {
          pod_name: podName,
          name: "domains",
          parent_id: configStream.id,
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
         WHERE stream_id = $(stream_id)
         ORDER BY index DESC
         LIMIT 1`,
        { stream_id: domainsStream.id },
      );

      const index = (lastRecord?.index ?? -1) + 1;
      const previousHash = lastRecord?.hash || null;

      // Store the complete list of domains in a single record
      const timestamp = new Date().toISOString();
      const content = { domains };
      const contentHash = calculateContentHash(content);
      const hash = calculateRecordHash(
        previousHash,
        contentHash,
        userId,
        timestamp,
      );

      const params = {
        stream_id: domainsStream.id,
        index: index,
        content: JSON.stringify(content),
        content_type: "application/json",
        name: `domains`,
        content_hash: contentHash,
        hash: hash,
        previous_hash: previousHash,
        user_id: userId,
        created_at: timestamp,
      };

      await t.none(sql.insert("record", params), params);

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
