/**
 * Update URL routing links for a pod
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { PodDbRow, StreamDbRow, RecordDbRow } from "../../db-types.js";
import { calculateContentHash, calculateRecordHash } from "../../utils.js";
import { createLogger } from "../../logger.js";
import { sql } from "../../db/index.js";
import { getCache } from "../../cache/index.js";

const logger = createLogger("webpods:domain:routing");

export async function updateLinks(
  ctx: DataContext,
  podName: string,
  links: Record<string, string>,
  userId: string,
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

      // Get or create .config stream
      let configStream = await t.oneOrNone<StreamDbRow>(
        `SELECT * FROM stream
         WHERE pod_name = $(pod_name)
           AND name = '.config'
           AND parent_id IS NULL`,
        { pod_name: podName },
      );

      if (!configStream) {
        // Create .config stream
        const configParams = {
          pod_name: podName,
          name: ".config",
          path: ".config",
          parent_id: null,
          user_id: userId,
          access_permission: "private",
          created_at: new Date(),
        };

        configStream = await t.one<StreamDbRow>(
          `${sql.insert("stream", configParams)} RETURNING *`,
          configParams,
        );
      }

      // Get or create routing stream as child of .config
      let routingStream = await t.oneOrNone<StreamDbRow>(
        `SELECT * FROM stream
         WHERE parent_id = $(parent_id)
           AND name = 'routing'`,
        { parent_id: configStream.id },
      );

      if (!routingStream) {
        // Create routing stream
        const routingParams = {
          pod_name: podName,
          name: "routing",
          path: ".config/routing",
          parent_id: configStream.id,
          user_id: userId,
          access_permission: "private",
          created_at: new Date(),
        };

        routingStream = await t.one<StreamDbRow>(
          `${sql.insert("stream", routingParams)} RETURNING *`,
          routingParams,
        );
      }

      // Get previous record for hash chain
      const previousRecord = await t.oneOrNone<RecordDbRow>(
        `SELECT * FROM record
         WHERE stream_id = $(stream_id)
         ORDER BY index DESC
         LIMIT 1`,
        { stream_id: routingStream.id },
      );

      const index = (previousRecord?.index ?? -1) + 1;
      const previousHash = previousRecord?.hash || null;
      const timestamp = new Date().toISOString();

      // Calculate hash
      const contentHash = calculateContentHash(links);
      const hash = calculateRecordHash(
        previousHash,
        contentHash,
        userId,
        timestamp,
      );
      const contentString = JSON.stringify(links);
      const size = Buffer.byteLength(contentString, "utf8");

      // Write new links record with all links in one record
      const params = {
        stream_id: routingStream.id,
        index: index,
        content: contentString,
        content_type: "application/json",
        size: size,
        name: "routes",
        path: ".config/routing/routes",
        content_hash: contentHash,
        hash: hash,
        previous_hash: previousHash,
        user_id: userId,
        created_at: timestamp,
      };

      await t.none(sql.insert("record", params), params);

      // Invalidate link resolution cache for this pod
      const cache = getCache();
      if (cache) {
        // Clear all cached link resolutions for this pod
        // Invalidate each specific link path
        for (const linkPath of Object.keys(links)) {
          await cache.delete("pods", `link:${podName}:${linkPath}`);
        }
      }

      return success(undefined);
    });
  } catch (error: unknown) {
    logger.error("Failed to update links", { error, podName });
    return failure(new Error("Failed to update links"));
  }
}
