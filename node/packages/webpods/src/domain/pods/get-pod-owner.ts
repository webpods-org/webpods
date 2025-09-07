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
    // Get the latest owner record using separate queries
    // Get .config stream
    const configStream = await ctx.db.oneOrNone<{ id: string }>(
      `SELECT id FROM stream 
       WHERE pod_name = $(pod_name) 
         AND name = '.config' 
         AND parent_id IS NULL`,
      { pod_name: podName },
    );

    if (!configStream) {
      return success(null);
    }

    // Get owner stream (child of .config)
    const ownerStream = await ctx.db.oneOrNone<{ id: string }>(
      `SELECT id FROM stream 
       WHERE parent_id = $(parent_id) 
         AND name = 'owner'`,
      { parent_id: configStream.id },
    );

    if (!ownerStream) {
      return success(null);
    }

    // Get owner record
    const ownerRecord = await ctx.db.oneOrNone<RecordDbRow>(
      `SELECT * FROM record 
       WHERE stream_id = $(stream_id)
         AND name = 'owner'
       ORDER BY index DESC
       LIMIT 1`,
      { stream_id: ownerStream.id },
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
  } catch (error: unknown) {
    logger.error("Failed to get pod owner", { error, podName });
    return failure({
      code: "GET_OWNER_ERROR",
      message: "Failed to get pod owner",
    } as any);
  }
}
