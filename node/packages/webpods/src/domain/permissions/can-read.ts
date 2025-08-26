/**
 * Check if a user can read from a stream
 */

import { DataContext } from "../data-context.js";
import { Stream } from "../../types.js";
import { PodDbRow } from "../../db-types.js";
import { createLogger } from "../../logger.js";
import { parsePermission } from "./parse-permission.js";
import { checkPermissionStream } from "./check-permission-stream.js";

const logger = createLogger("webpods:domain:permissions");

export async function canRead(
  ctx: DataContext,
  stream: Stream,
  userId: string | null,
): Promise<boolean> {
  logger.info("canRead check", {
    streamId: stream.name,
    accessPermission: stream.accessPermission,
    userId,
    creatorId: stream.userId,
  });

  // Creator always has access
  if (userId && userId === stream.userId) {
    return true;
  }

  // Public read access - anyone can read
  if (stream.accessPermission === "public") {
    return true;
  }

  // Private access - only creator
  if (stream.accessPermission === "private") {
    return userId === stream.userId;
  }

  // No auth means no access for non-public
  if (!userId) {
    return false;
  }

  // Parse permission
  const perm = parsePermission(stream.accessPermission);
  logger.debug("Parsed permission", {
    perm,
    accessPermission: stream.accessPermission,
  });

  if (perm.type === "stream" && perm.streamPath) {
    logger.info("Checking stream-based permission", {
      streamPath: perm.streamPath,
      userId,
      streamId: stream.name,
    });
    // Get pod for this stream
    const pod = await ctx.db.oneOrNone<PodDbRow>(
      `SELECT * FROM pod WHERE name = $(pod_name)`,
      { pod_name: stream.podName },
    );

    if (!pod) {
      logger.error("Pod not found for stream", { podName: stream.podName });
      return false;
    }

    // Check if user has read permission in the permission stream
    const result = await checkPermissionStream(
      ctx,
      pod.name,
      perm.streamPath,
      userId,
      "read",
    );
    logger.info("Stream permission check result", {
      allowed: result,
      podName: pod.name,
      streamPath: perm.streamPath,
      userId,
    });
    return result;
  }

  return false;
}
