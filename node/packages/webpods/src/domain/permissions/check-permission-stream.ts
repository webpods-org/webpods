/**
 * Check if user exists in permission stream
 */

import { DataContext } from "../data-context.js";
import { RecordDbRow } from "../../db-types.js";
import { createLogger } from "../../logger.js";
import { getStreamByPath } from "../streams/get-stream-by-path.js";

const logger = createLogger("webpods:domain:permissions");

export async function checkPermissionStream(
  ctx: DataContext,
  podName: string,
  streamPath: string,
  userId: string,
  action: "read" | "write",
): Promise<boolean> {
  try {
    logger.debug("Checking permission stream", {
      podName,
      streamPath,
      userId,
      action,
    });

    // Use cached stream lookup instead of manual traversal
    const streamResult = await getStreamByPath(ctx, podName, streamPath);
    
    if (!streamResult.success) {
      logger.warn("Permission stream not found", {
        podName,
        streamPath,
      });
      return false;
    }

    const stream = streamResult.data;

    logger.info("Permission stream found", {
      streamName: stream.name,
      podName: stream.podName,
    });

    // Get ALL records from the permission stream
    const records = await ctx.db.manyOrNone<RecordDbRow>(
      `SELECT * FROM record
       WHERE stream_id = $(streamId)
       ORDER BY index ASC`,
      { streamId: stream.id },
    );

    // Process records in memory to find the latest permission for this user
    let userPermission: { id: string; read?: boolean; write?: boolean } | null =
      null;
    for (const record of records) {
      try {
        const content =
          typeof record.content === "string"
            ? JSON.parse(record.content)
            : record.content;

        // Check if this record is for our user
        if (content.userId === userId) {
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
      streamName: stream.name,
      permission: userPermission,
      recordCount: records.length,
    });

    if (!userPermission) {
      return false;
    }

    // Check if action is allowed
    const allowed = userPermission[action] === true;

    return allowed;
  } catch (error) {
    logger.error("Failed to check permission stream", {
      error,
      podName,
      streamPath,
      userId,
    });
    return false;
  }
}
