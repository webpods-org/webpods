/**
 * Create a new pod
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { PodDbRow, StreamDbRow } from "../../db-types.js";
import { Pod } from "../../types.js";
import { isValidPodName, calculateRecordHash } from "../../utils.js";
import { createLogger } from "../../logger.js";
import { sql } from "../../db/index.js";

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

export async function createPod(
  ctx: DataContext,
  userId: string,
  podName: string,
): Promise<Result<Pod>> {
  // Validate pod name
  if (!isValidPodName(podName)) {
    return failure(
      new Error("Pod name must be lowercase alphanumeric with hyphens"),
    );
  }

  try {
    return await ctx.db.tx(async (t) => {
      // Check if pod already exists
      const existing = await t.oneOrNone<PodDbRow>(
        `SELECT * FROM pod WHERE name = $(pod_name)`,
        { pod_name: podName },
      );

      if (existing) {
        return failure(new Error("Pod already exists"));
      }

      // Create pod with snake_case parameters
      const podParams = {
        name: podName,
        created_at: new Date(),
      };

      const pod = await t.one<PodDbRow>(
        `${sql.insert("pod", podParams)} RETURNING *`,
        podParams,
      );

      // Create .meta/owner stream with snake_case parameters
      const streamParams = {
        pod_name: pod.name,
        name: ".meta/owner",
        user_id: userId,
        access_permission: "private",
        created_at: new Date(),
      };

      await t.one<StreamDbRow>(
        `${sql.insert("stream", streamParams)} RETURNING *`,
        streamParams,
      );

      // Write initial owner record with snake_case parameters
      const ownerContent = { owner: userId };
      const timestamp = new Date().toISOString();
      const hash = calculateRecordHash(null, timestamp, ownerContent);

      const recordParams = {
        stream_pod_name: pod.name,
        stream_name: ".meta/owner",
        index: 0,
        content: JSON.stringify(ownerContent),
        content_type: "application/json",
        name: "owner",
        hash: hash,
        previous_hash: null,
        user_id: userId,
        created_at: timestamp,
      };

      await t.none(sql.insert("record", recordParams), recordParams);

      logger.info("Pod created", { podName, userId });
      const mappedPod = mapPodFromDb(pod);
      mappedPod.user_id = userId; // Set owner from what we just wrote
      return success(mappedPod);
    });
  } catch (error: any) {
    logger.error("Failed to create pod", { error, podName });
    return failure(new Error("Failed to create pod"));
  }
}
