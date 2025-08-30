/**
 * Check if a user can write to a stream
 */

import { DataContext } from "../data-context.js";
import { Stream } from "../../types.js";
import { PodDbRow, RecordDbRow } from "../../db-types.js";
import { parsePermission } from "./parse-permission.js";
import { checkPermissionStream } from "./check-permission-stream.js";

export async function canWrite(
  ctx: DataContext,
  stream: Stream,
  userId: string,
): Promise<boolean> {
  // First check pod ownership - pod owner always has full access
  const ownerRecord = await ctx.db.oneOrNone<RecordDbRow>(
    `SELECT r.* FROM record r
     WHERE r.pod_name = $(pod_name)
       AND r.stream_name = '.meta/streams/owner'
       AND r.name = 'owner'
     ORDER BY r.index DESC
     LIMIT 1`,
    { pod_name: stream.podName },
  );

  if (ownerRecord) {
    try {
      const content = JSON.parse(ownerRecord.content);
      const podOwner = content.owner;

      // If user is the pod owner, they have full access
      if (podOwner === userId) {
        return true;
      }

      // If user is NOT the pod owner but was the stream creator,
      // they no longer have access after ownership transfer
      if (userId === stream.userId && podOwner !== userId) {
        return false;
      }
    } catch {
      // If we can't parse owner record, fall through to normal checks
    }
  }

  // Creator has access (only if they're still the pod owner or no owner is set)
  if (userId === stream.userId) {
    return true;
  }

  // Public write access - authenticated users can write
  if (stream.accessPermission === "public") {
    return true;
  }

  // Private access - only creator
  if (stream.accessPermission === "private") {
    return userId === stream.userId;
  }

  // Parse permission
  const perm = parsePermission(stream.accessPermission);

  if (perm.type === "stream" && perm.streamPath) {
    // Get pod for this stream
    const pod = await ctx.db.oneOrNone<PodDbRow>(
      `SELECT * FROM pod WHERE name = $(pod_name)`,
      { pod_name: stream.podName },
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
