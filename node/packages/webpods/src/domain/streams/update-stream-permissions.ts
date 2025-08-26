/**
 * Update stream permissions
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { createLogger } from "../../logger.js";
import { sql } from "../../db/index.js";

const logger = createLogger("webpods:domain:streams");

export async function updateStreamPermissions(
  ctx: DataContext,
  podName: string,
  streamId: string,
  accessPermission: string,
): Promise<Result<void>> {
  try {
    const params = {
      access_permission: accessPermission,
    };

    await ctx.db.none(
      `${sql.update("stream", params)}
       WHERE pod_name = $(pod_name)
         AND name = $(name)`,
      { ...params, pod_name: podName, name: streamId },
    );

    logger.info("Stream permissions updated", {
      podName,
      streamId,
      accessPermission,
    });
    return success(undefined);
  } catch (error: any) {
    logger.error("Failed to update stream permissions", {
      error,
      podName,
      streamId,
      accessPermission,
    });
    return failure(new Error("Failed to update stream permissions"));
  }
}
