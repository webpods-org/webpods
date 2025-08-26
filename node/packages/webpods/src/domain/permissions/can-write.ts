/**
 * Check if a user can write to a stream
 */

import { DataContext } from "../data-context.js";
import { Stream } from "../../types.js";
import { PodDbRow } from "../../db-types.js";
import { parsePermission } from "./parse-permission.js";
import { checkPermissionStream } from "./check-permission-stream.js";

export async function canWrite(
  ctx: DataContext,
  stream: Stream,
  userId: string,
): Promise<boolean> {
  // Creator always has access
  if (userId === stream.user_id) {
    return true;
  }

  // Public write access - authenticated users can write
  if (stream.access_permission === "public") {
    return true;
  }

  // Private access - only creator
  if (stream.access_permission === "private") {
    return userId === stream.user_id;
  }

  // Parse permission
  const perm = parsePermission(stream.access_permission);

  if (perm.type === "stream" && perm.streamPath) {
    // Get pod for this stream
    const pod = await ctx.db.oneOrNone<PodDbRow>(
      `SELECT * FROM pod WHERE name = $(pod_name)`,
      { pod_name: stream.pod_name },
    );

    if (!pod) return false;

    // Check if user has write permission in the permission stream
    return await checkPermissionStream(
      ctx,
      pod.name,
      perm.streamPath,
      userId,
      "write",
    );
  }

  return false;
}
