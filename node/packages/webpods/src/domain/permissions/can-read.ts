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
    streamId: stream.stream_id,
    accessPermission: stream.access_permission,
    userId,
    creatorId: stream.user_id,
  });

  // Creator always has access
  if (userId && userId === stream.user_id) {
    return true;
  }

  // Public read access - anyone can read
  if (stream.access_permission === "public") {
    return true;
  }

  // Private access - only creator
  if (stream.access_permission === "private") {
    return userId === stream.user_id;
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

  if (perm.type === "stream" && perm.streamPath) {
    logger.info("Checking stream-based permission", {
      streamPath: perm.streamPath,
      userId,
      streamId: stream.stream_id,
    });
    // Get pod for this stream
    const pod = await ctx.db.oneOrNone<PodDbRow>(
      `SELECT * FROM pod WHERE name = $(pod_name)`,
      { pod_name: stream.pod_name },
    );

    if (!pod) {
      logger.error("Pod not found for stream", { podName: stream.pod_name });
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
