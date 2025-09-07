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

    // First resolve the stream path to get the stream
    const segments = streamPath.split("/").filter(Boolean);
    let currentStream: StreamDbRow | null = null;
    let parentId: number | null = null;

    // Traverse the path to find the stream
    for (const segment of segments) {
      const segmentStream: StreamDbRow | null =
        await ctx.db.oneOrNone<StreamDbRow>(
          parentId === null
            ? `SELECT * FROM stream 
             WHERE pod_name = $(pod_name) 
               AND name = $(name)
               AND parent_id IS NULL`
            : `SELECT * FROM stream 
             WHERE pod_name = $(pod_name) 
               AND name = $(name)
               AND parent_id = $(parent_id)`,
          { pod_name: podName, name: segment, parent_id: parentId },
        );

      if (!segmentStream) {
        logger.warn("Permission stream not found", {
          podName,
          streamPath,
          segment,
        });
        return false;
      }

      currentStream = segmentStream;
      parentId = segmentStream.id;
    }

    const stream = currentStream;

    if (!stream) {
      logger.warn("Permission stream not found", {
        podName,
        streamPath,
      });
      return false;
    }

    logger.info("Permission stream found", {
      streamName: stream.name,
      podName: stream.pod_name,
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
