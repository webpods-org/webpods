/**
 * Transfer pod ownership to another user
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { createError } from "../../utils/errors.js";
import { StreamDbRow, RecordDbRow } from "../../db-types.js";
import { calculateRecordHash } from "../../utils.js";
import { createLogger } from "../../logger.js";
import { sql } from "../../db/index.js";

const logger = createLogger("webpods:domain:pods");

export async function transferPodOwnership(
  ctx: DataContext,
  podName: string,
  fromUserId: string,
  toUserId: string,
): Promise<Result<void>> {
  try {
    return await ctx.db.tx(async (t) => {
      // Get the .meta/owner stream
      const ownerStream = await t.oneOrNone<StreamDbRow>(
        `SELECT s.* FROM stream s
         JOIN pod p ON p.id = s.pod_id
         WHERE p.name = $(pod_name)
           AND s.stream_id = '.meta/owner'`,
        { pod_name: podName },
      );

      if (!ownerStream) {
        return failure(new Error("Owner stream not found"));
      }

      // Verify current owner
      const currentOwnerRecord = await t.oneOrNone<RecordDbRow>(
        `SELECT * FROM record
         WHERE stream_id = $(stream_id)
           AND name = 'owner'
         ORDER BY index DESC
         LIMIT 1`,
        { stream_id: ownerStream.id },
      );

      if (!currentOwnerRecord) {
        return failure(new Error("Current owner record not found"));
      }

      try {
        const content = JSON.parse(currentOwnerRecord.content);
        if (content.owner !== fromUserId) {
          return failure(
            createError(
              "FORBIDDEN",
              "Only the current owner can transfer ownership",
            ),
          );
        }
      } catch {
        return failure(new Error("Failed to verify current owner"));
      }

      // Get the previous record for hash chain
      const previousRecord = await t.oneOrNone<RecordDbRow>(
        `SELECT * FROM record
         WHERE stream_id = $(stream_id)
         ORDER BY index DESC
         LIMIT 1`,
        { stream_id: ownerStream.id },
      );

      const index = (previousRecord?.index ?? -1) + 1;
      const previousHash = previousRecord?.hash || null;
      const timestamp = new Date().toISOString();

      // Create new owner record
      const newOwnerContent = { owner: toUserId };
      const hash = calculateRecordHash(
        previousHash,
        timestamp,
        newOwnerContent,
      );

      // Insert new owner record with snake_case parameters
      const params = {
        stream_id: ownerStream.id,
        index: index,
        content: JSON.stringify(newOwnerContent),
        content_type: "application/json",
        name: "owner",
        hash: hash,
        previous_hash: previousHash,
        user_id: fromUserId,
        created_at: timestamp,
      };

      await t.none(sql.insert("record", params), params);

      logger.info("Pod ownership transferred", {
        podName,
        fromUserId,
        toUserId,
      });
      return success(undefined);
    });
  } catch (error: any) {
    logger.error("Failed to transfer pod ownership", {
      error,
      podName,
      fromUserId,
      toUserId,
    });
    return failure(new Error("Failed to transfer pod ownership"));
  }
}
