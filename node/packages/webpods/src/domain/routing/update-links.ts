/**
 * Update URL routing links for a pod
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { PodDbRow, StreamDbRow, RecordDbRow } from "../../db-types.js";
import { calculateRecordHash } from "../../utils.js";
import { createLogger } from "../../logger.js";
import { sql } from "../../db/index.js";

const logger = createLogger("webpods:domain:routing");

export async function updateLinks(
  ctx: DataContext,
  podName: string,
  links: Record<string, string>,
  userId: string,
  authorId: string,
): Promise<Result<void>> {
  try {
    return await ctx.db.tx(async (t) => {
      // Get pod
      const pod = await t.oneOrNone<PodDbRow>(
        `SELECT * FROM pod WHERE name = $(podName)`,
        { podName },
      );

      if (!pod) {
        return failure(new Error("Pod not found"));
      }

      const podId = pod.id;
      // Get or create .meta/links stream
      let linksStream = await t.oneOrNone<StreamDbRow>(
        `SELECT * FROM stream
         WHERE pod_id = $(podId)
           AND stream_id = '.meta/links'`,
        { podId },
      );

      if (!linksStream) {
        // Create the stream with snake_case parameters
        const streamParams = {
          id: crypto.randomUUID(),
          pod_id: podId,
          stream_id: ".meta/links",
          user_id: userId,
          access_permission: "private",
          created_at: new Date(),
        };

        linksStream = await t.one<StreamDbRow>(
          `${sql.insert("stream", streamParams)} RETURNING *`,
          streamParams,
        );
      }

      // Get previous record for hash chain
      const previousRecord = await t.oneOrNone<RecordDbRow>(
        `SELECT * FROM record
         WHERE stream_id = $(streamId)
         ORDER BY index DESC
         LIMIT 1`,
        { streamId: linksStream.id },
      );

      const index = (previousRecord?.index ?? -1) + 1;
      const previousHash = previousRecord?.hash || null;
      const timestamp = new Date().toISOString();

      // Calculate hash
      const hash = calculateRecordHash(previousHash, timestamp, links);

      // Write new links record with all links in one record
      const params = {
        stream_id: linksStream.id,
        index: index,
        content: JSON.stringify(links),
        content_type: "application/json",
        name: `links-${index}`,
        hash: hash,
        previous_hash: previousHash,
        user_id: authorId,
        created_at: timestamp,
      };

      await t.none(sql.insert("record", params), params);

      logger.info("Links updated", {
        podName,
        linkCount: Object.keys(links).length,
      });
      return success(undefined);
    });
  } catch (error: any) {
    logger.error("Failed to update links", { error, podName });
    return failure(new Error("Failed to update links"));
  }
}
