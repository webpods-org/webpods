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
         AND name = $(name)`,
      { pod_name: podName, name: streamId },
    );

    if (!stream) {
      logger.warn("Permission stream not found", { podName, streamId });
      return false;
    }

    logger.info("Permission stream found", {
      streamId: stream.name,
      podName: stream.pod_name,
    });

    // Get ALL records from the permission stream
    const records = await ctx.db.manyOrNone<RecordDbRow>(
      `SELECT * FROM record
       WHERE pod_name = $(pod_name)
         AND stream_name = $(stream_name)
       ORDER BY index ASC`,
      { pod_name: podName, stream_name: streamId },
    );

    // Process records in memory to find the latest permission for this user
    let userPermission: { id: string; read?: boolean; write?: boolean } | null = null;
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
      streamId: stream.name,
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
