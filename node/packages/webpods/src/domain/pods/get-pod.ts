/**
 * Get pod by name
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { PodDbRow, RecordDbRow } from "../../db-types.js";
import { Pod } from "../../types.js";
import { createLogger } from "../../logger.js";

const logger = createLogger("webpods:domain:pods");

/**
 * Map database row to domain type
 */
function mapPodFromDb(row: PodDbRow): Pod {
  return {
    name: row.name,
    user_id: "", // Will be populated from .meta/owner stream
    metadata: row.metadata,
    created_at: row.created_at,
    updated_at: row.updated_at || row.created_at,
  };
}

export async function getPod(
  ctx: DataContext,
  podName: string,
): Promise<Result<Pod>> {
  try {
    const pod = await ctx.db.oneOrNone<PodDbRow>(
      `SELECT * FROM pod WHERE name = $(pod_name)`,
      { pod_name: podName },
    );

    if (!pod) {
      return failure(new Error("Pod not found"));
    }

    // Get owner from .meta/owner stream
    const ownerRecord = await ctx.db.oneOrNone<RecordDbRow>(
      `SELECT r.* FROM record r
       WHERE r.pod_name = $(pod_name)
         AND r.stream_name = '.meta/owner'
         AND r.name = 'owner'
       ORDER BY r.index DESC
       LIMIT 1`,
      { pod_name: pod.name },
    );

    const mappedPod = mapPodFromDb(pod);
    if (ownerRecord) {
      try {
        const content = JSON.parse(ownerRecord.content);
        mappedPod.user_id = content.owner || "";
      } catch {
        logger.warn("Failed to parse owner record", { podName });
      }
    }

    return success(mappedPod);
  } catch (error: any) {
    logger.error("Failed to get pod", { error, podName });
    return failure(new Error("Failed to get pod"));
  }
}
