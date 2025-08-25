/**
 * Check if a user can read from a stream
 */

import { DataContext } from "../data-context.js";
import { PodDbRow, StreamDbRow, RecordDbRow } from "../../db-types.js";
import { createLogger } from "../../logger.js";
import { parsePermission } from "./parse-permission.js";

const logger = createLogger("webpods:domain:permissions");

export async function canRead(
  ctx: DataContext,
  podId: string,
  streamId: string,
  userId: string | null,
): Promise<boolean> {
  try {
    // Get pod
    const pod = await ctx.db.oneOrNone<PodDbRow>(
      `SELECT * FROM pod WHERE id = $(podId)`,
      { podId },
    );

    if (!pod) {
      return false;
    }

    // Get stream
    const stream = await ctx.db.oneOrNone<StreamDbRow>(
      `SELECT * FROM stream
       WHERE pod_id = $(podId)
         AND stream_id = $(streamId)`,
      { podId, streamId },
    );

    if (!stream) {
      return false;
    }

    // Parse the permission
    const permission = parsePermission(stream.access_permission);

    // Public streams are readable by anyone
    if (permission.type === "public") {
      return true;
    }

    // Private streams require authentication
    if (!userId) {
      return false;
    }

    // Private streams are only readable by the creator
    if (permission.type === "private") {
      return stream.user_id === userId;
    }

    // Stream-based permissions
    if (permission.type === "stream" && permission.streamPath) {
      // Get the permission stream
      const permissionStream = await ctx.db.oneOrNone<StreamDbRow>(
        `SELECT * FROM stream
         WHERE pod_id = $(podId)
           AND stream_id = $(streamPath)`,
        { podId, streamPath: permission.streamPath },
      );

      if (!permissionStream) {
        // If permission stream doesn't exist, default to creator-only
        return stream.user_id === userId;
      }

      // Get all records from the permission stream
      const records = await ctx.db.manyOrNone<RecordDbRow>(
        `SELECT * FROM record
         WHERE stream_id = $(streamId)
         ORDER BY index ASC`,
        { streamId: permissionStream.id },
      );

      // Process records to determine current permission state
      let userPermission: any = null;
      for (const record of records) {
        try {
          const content = JSON.parse(record.content);
          if (content.id === userId) {
            userPermission = content;
          }
        } catch {
          // Skip invalid JSON
        }
      }

      // Check permission
      if (userPermission) {
        if (userPermission.action === "deny") {
          return false;
        }
        if (userPermission.action === "allow" && userPermission.permission === "read") {
          return true;
        }
      }

      // Default to creator-only if not explicitly allowed
      return stream.user_id === userId;
    }

    // Default to denying access
    return false;
  } catch (error) {
    logger.error("Failed to check read permission", {
      error,
      podId,
      streamId,
      userId,
    });
    return false;
  }
}