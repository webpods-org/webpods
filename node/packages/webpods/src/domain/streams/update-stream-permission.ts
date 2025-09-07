/**
 * Update stream access permission
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { createError } from "../../utils/errors.js";
import { StreamDbRow } from "../../db-types.js";
import { createLogger } from "../../logger.js";

const logger = createLogger("webpods:domain:streams");

export async function updateStreamPermission(
  ctx: DataContext,
  streamId: number,
  accessPermission: string,
): Promise<Result<{ updated: boolean }>> {
  try {
    // Valid access permissions are: public, private, or a path to a permission stream
    if (!accessPermission) {
      return failure(
        createError("INVALID_PERMISSION", "Access permission is required"),
      );
    }

    // Update the stream's access permission
    const updated = await ctx.db.oneOrNone<StreamDbRow>(
      `UPDATE stream 
       SET access_permission = $(accessPermission),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $(streamId)
       RETURNING *`,
      { streamId, accessPermission },
    );

    if (!updated) {
      return failure(createError("STREAM_NOT_FOUND", "Stream not found"));
    }

    logger.debug("Updated stream permission", {
      streamId,
      accessPermission,
      podName: updated.pod_name,
      streamName: updated.name,
    });

    return success({ updated: true });
  } catch (error: unknown) {
    logger.error("Failed to update stream permission", { error, streamId });
    return failure(
      createError("DATABASE_ERROR", "Failed to update stream permission"),
    );
  }
}
