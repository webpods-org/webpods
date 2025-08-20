/**
 * Permission checking domain logic
 */

import { Database } from "../db.js";
import { PodDbRow, StreamDbRow, RecordDbRow } from "../db-types.js";
import { Stream } from "../types.js";
import { createLogger } from "../logger.js";

const logger = createLogger("webpods:domain:permissions");

/**
 * Parse permission string into components
 */
export function parsePermission(permission: string): {
  type: "basic" | "stream";
  stream?: string;
} {
  if (permission === "public" || permission === "private") {
    return { type: "basic" };
  }

  if (permission.startsWith("/")) {
    return { type: "stream", stream: permission.substring(1) };
  }

  return { type: "basic" };
}

/**
 * Check if user exists in permission stream
 */
async function checkPermissionStream(
  db: Database,
  podId: string,
  streamId: string,
  userId: string,
  action: "read" | "write",
): Promise<boolean> {
  try {
    logger.debug("Checking permission stream", {
      podId,
      streamId,
      userId,
      action,
    });

    // First check if the stream exists
    const stream = await db.oneOrNone<StreamDbRow>(
      `SELECT s.*
       FROM stream s
       JOIN pod p ON p.id = s.pod_id
       WHERE p.pod_id = $(podId)
         AND s.stream_id = $(streamId)`,
      { podId, streamId },
    );

    if (!stream) {
      logger.warn("Permission stream not found", { podId, streamId });
      return false;
    }

    logger.info("Permission stream found", {
      streamId: stream.stream_id,
      id: stream.id,
    });

    // Get ALL records from the permission stream
    const records = await db.manyOrNone<RecordDbRow>(
      `SELECT * FROM record
       WHERE stream_id = $(streamId)
       ORDER BY index ASC`,
      { streamId: stream.id },
    );

    // Process records in memory to find the latest permission for this user
    let userPermission = null;
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
      streamId,
      permission: userPermission,
    });

    if (!userPermission) {
      return false;
    }

    // Check if action is allowed
    const allowed = userPermission[action] === true;
    logger.debug("Permission check result", {
      userId,
      action,
      allowed,
      userPermission,
    });

    return allowed;
  } catch (error) {
    logger.error("Failed to check permission stream", {
      error,
      podId,
      streamId,
      userId,
    });
    return false;
  }
}

/**
 * Check if user can read from stream
 */
export async function canRead(
  db: Database,
  stream: Stream,
  userId: string | null,
): Promise<boolean> {
  logger.info("canRead check", {
    streamId: stream.stream_id,
    accessPermission: stream.access_permission,
    userId,
    creatorId: stream.creator_id,
  });

  // Creator always has access
  if (userId && userId === stream.creator_id) {
    return true;
  }

  // Public read access - anyone can read
  if (stream.access_permission === "public") {
    return true;
  }

  // Private access - only creator
  if (stream.access_permission === "private") {
    return userId === stream.creator_id;
  }

  // No auth means no access for non-public
  if (!userId) {
    return false;
  }

  // Parse permission
  const perm = parsePermission(stream.access_permission);
  logger.debug("Parsed permission", {
    perm,
    accessPermission: stream.access_permission,
  });

  if (perm.type === "stream" && perm.stream) {
    // Get pod for this stream
    const pod = await db.oneOrNone<PodDbRow>(
      `SELECT * FROM pod WHERE id = $(podId)`,
      { podId: stream.pod_id },
    );

    if (!pod) return false;

    // Check if user has read permission in the permission stream
    return await checkPermissionStream(
      db,
      pod.pod_id,
      perm.stream,
      userId,
      "read",
    );
  }

  return false;
}

/**
 * Check if user can write to stream
 */
export async function canWrite(
  db: Database,
  stream: Stream,
  userId: string,
): Promise<boolean> {
  // Creator always has access
  if (userId === stream.creator_id) {
    return true;
  }

  // Public write access - authenticated users can write
  if (stream.access_permission === "public") {
    return true;
  }

  // Private access - only creator
  if (stream.access_permission === "private") {
    return userId === stream.creator_id;
  }

  // Parse permission
  const perm = parsePermission(stream.access_permission);

  if (perm.type === "stream" && perm.stream) {
    // Get pod for this stream
    const pod = await db.oneOrNone<PodDbRow>(
      `SELECT * FROM pod WHERE id = $(podId)`,
      { podId: stream.pod_id },
    );

    if (!pod) return false;

    // Check if user has write permission in the permission stream
    return await checkPermissionStream(
      db,
      pod.pod_id,
      perm.stream,
      userId,
      "write",
    );
  }

  return false;
}
