/**
 * Get the current owner of a pod
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { RecordDbRow } from "../../db-types.js";
import { createLogger } from "../../logger.js";

const logger = createLogger("webpods:domain:pods");

export async function getPodOwner(
  ctx: DataContext,
  podName: string,
): Promise<Result<string | null>> {
  try {
    // Get the latest owner record from .meta/owner stream
    const ownerRecord = await ctx.db.oneOrNone<RecordDbRow>(
      `SELECT r.* FROM record r
       WHERE r.pod_name = $(pod_name)
         AND r.stream_name = '.meta/owner'
         AND r.name = 'owner'
       ORDER BY r.index DESC
       LIMIT 1`,
      { pod_name: podName },
    );

    if (!ownerRecord) {
      return success(null);
    }

    try {
      const content = JSON.parse(ownerRecord.content);
      return success(content.owner || null);
    } catch {
      logger.warn("Failed to parse owner record", { podName });
      return success(null);
    }
  } catch (error: any) {
    logger.error("Failed to get pod owner", { error, podName });
    return failure(new Error("Failed to get pod owner"));
  }
}
