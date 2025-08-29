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
    // Get all pods where the user is the owner
    // Since ownership is in .meta/owner stream, we need to query records
    const pods = await ctx.db.manyOrNone<
      PodDbRow & { owner_content: string | null }
    >(
      `SELECT DISTINCT p.*, 
              r.content as owner_content,
              p.created_at,
              p.metadata
       FROM pod p
       LEFT JOIN stream s ON s.pod_name = p.name AND s.name = '.meta/owner'
       LEFT JOIN record r ON r.pod_name = p.name 
                          AND r.stream_name = '.meta/owner' 
                          AND r.name = 'owner'
       WHERE r.content IS NOT NULL
       ORDER BY p.created_at DESC`,
    );

    // Filter pods by owner
    const userPods = pods
      .filter((pod) => {
        try {
          const content = JSON.parse(pod.owner_content || "{}");
          return content.owner === userId;
        } catch {
          return false;
        }
      })
      .map((pod) => ({
        name: pod.name,
        created_at: pod.created_at,
        metadata: pod.metadata,
      }));

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
