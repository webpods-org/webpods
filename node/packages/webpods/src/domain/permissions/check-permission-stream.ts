/**
 * Check if user exists in permission stream
 */

import { DataContext } from "../data-context.js";
import { StreamDbRow, RecordDbRow } from "../../db-types.js";
import { createLogger } from "../../logger.js";

const logger = createLogger("webpods:domain:permissions");

export async function checkPermissionStream(
  ctx: DataContext,
  podName: string,
  streamId: string,
  userId: string,
  action: "read" | "write",
): Promise<boolean> {
  try {
    logger.debug("Checking permission stream", {
      podName,
      streamId,
      userId,
      action,
    });

    // First check if the stream exists
    const stream = await ctx.db.oneOrNone<StreamDbRow>(
      `SELECT * FROM stream
       WHERE pod_name = $(pod_name)
         AND stream_id = $(stream_id)`,
      { pod_name: podName, stream_id: streamId },
    );

    if (!stream) {
      logger.warn("Permission stream not found", { podName, streamId });
      return false;
    }

    logger.info("Permission stream found", {
      streamId: stream.stream_id,
      podName: stream.pod_name,
    });

    // Get ALL records from the permission stream
    const records = await ctx.db.manyOrNone<RecordDbRow>(
      `SELECT * FROM record
       WHERE stream_pod_name = $(stream_pod_name)
         AND stream_id = $(stream_id)
       ORDER BY index ASC`,
      { stream_pod_name: podName, stream_id: streamId },
    );

    // Process records in memory to find the latest permission for this user
    let userPermission: any = null;
    for (const record of records) {
      try {
        const content =
          typeof record.content === "string"
            ? JSON.parse(record.content)
            : record.content;

        // Check if this record is for our user
        if (content.id === userId) {
          // Last record wins
          userPermission = content;
        }
      } catch {
        // Skip records that aren't valid JSON or don't have the right structure
        logger.debug("Skipping non-permission record", { recordId: record.id });
      }
    }

    logger.info("Permission check result", {
      found: !!userPermission,
      userId,
      streamId: stream.stream_id,
      permission: userPermission,
      recordCount: records.length,
    });

    if (!userPermission) {
      logger.debug("No permission found for user", { userId, streamId });
      return false;
    }

    // Check if action is allowed
    const allowed = userPermission[action] === true;
    logger.info("Permission check final result", {
      userId,
      action,
      allowed,
      userPermission,
    });

    return allowed;
  } catch (error) {
    logger.error("Failed to check permission stream", {
      error,
      podName,
      streamId,
      userId,
    });
    return false;
  }
}
