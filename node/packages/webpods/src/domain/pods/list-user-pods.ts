/**
 * List all pods owned by a user
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { PodDbRow } from "../../db-types.js";
import { createLogger } from "../../logger.js";

const logger = createLogger("webpods:domain:pods");

export interface UserPod {
  name: string;
  created_at: Date;
  metadata: Record<string, unknown>;
}

export async function listUserPods(
  ctx: DataContext,
  userId: string,
): Promise<Result<UserPod[]>> {
  try {
    // Get all pods first
    const pods = await ctx.db.manyOrNone<PodDbRow>(
      `SELECT * FROM pod ORDER BY created_at DESC`,
    );

    // Check ownership for each pod using separate queries
    const userPods: UserPod[] = [];

    for (const pod of pods) {
      // Get .config stream
      const configStream = await ctx.db.oneOrNone<{ id: string }>(
        `SELECT id FROM stream 
         WHERE pod_name = $(pod_name) 
           AND name = '.config' 
           AND parent_id IS NULL`,
        { pod_name: pod.name },
      );

      if (!configStream) continue;

      // Get owner stream (child of .config)
      const ownerStream = await ctx.db.oneOrNone<{ id: string }>(
        `SELECT id FROM stream 
         WHERE parent_id = $(parent_id) 
           AND name = 'owner'`,
        { parent_id: configStream.id },
      );

      if (!ownerStream) continue;

      // Get owner record
      const ownerRecord = await ctx.db.oneOrNone<{ content: string }>(
        `SELECT content FROM record 
         WHERE stream_id = $(stream_id)
           AND name = 'owner'
         ORDER BY index DESC
         LIMIT 1`,
        { stream_id: ownerStream.id },
      );

      if (ownerRecord) {
        try {
          const content = JSON.parse(ownerRecord.content);
          if (content.owner === userId) {
            userPods.push({
              name: pod.name,
              created_at: pod.created_at,
              metadata: pod.metadata || {},
            });
          }
        } catch {
          // Invalid JSON, skip
        }
      }
    }

    logger.info("Listed pods for user", {
      userId,
      count: userPods.length,
    });

    return success(userPods);
  } catch (error: unknown) {
    logger.error("Failed to list user pods", { error, userId });
    return failure(new Error("Failed to list user pods"));
  }
}
