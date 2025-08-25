/**
 * Pod operations domain logic
 */

import { Database, sql } from "../db/index.js";
import { PodDbRow, StreamDbRow, RecordDbRow } from "../db-types.js";
import { Pod, Stream, Result } from "../types.js";
import { isValidPodName, calculateRecordHash } from "../utils.js";
import { createLogger } from "../logger.js";

const logger = createLogger("webpods:domain:pods");

/**
 * Map database row to domain type
 */
function mapPodFromDb(row: PodDbRow): Pod {
  return {
    id: row.id,
    name: row.name,
    user_id: "", // Will be populated from .meta/owner stream
    metadata: undefined,
    created_at: row.created_at,
    updated_at: row.created_at,
  };
}

/**
 * Map stream database row to domain type
 */
function mapStreamFromDb(row: StreamDbRow): Stream {
  return {
    id: row.id,
    pod_id: row.pod_id,
    stream_id: row.stream_id,
    user_id: row.user_id,
    access_permission: row.access_permission,
    metadata: undefined,
    created_at: row.created_at,
    updated_at: row.created_at,
  };
}

/**
 * Create a new pod
 */
export async function createPod(
  db: Database,
  userId: string,
  podName: string,
): Promise<Result<Pod>> {
  // Validate pod name
  if (!isValidPodName(podName)) {
    return {
      success: false,
      error: {
        code: "INVALID_POD_NAME",
        message: "Pod name must be lowercase alphanumeric with hyphens",
      },
    };
  }

  try {
    return await db.tx(async (t) => {
      // Check if pod already exists
      const existing = await t.oneOrNone<PodDbRow>(
        `SELECT * FROM pod WHERE name = $(podName)`,
        { podName },
      );

      if (existing) {
        return {
          success: false,
          error: {
            code: "POD_EXISTS",
            message: "Pod already exists",
          },
        };
      }

      // Create pod with snake_case parameters
      const podParams = {
        id: crypto.randomUUID(),
        name: podName,
        created_at: new Date(),
      };
      
      const pod = await t.one<PodDbRow>(
        `${sql.insert("pod", podParams)} RETURNING *`,
        podParams,
      );

      // Create .meta/owner stream with snake_case parameters
      const streamParams = {
        id: crypto.randomUUID(),
        pod_id: pod.id,
        stream_id: ".meta/owner",
        user_id: userId,
        access_permission: "private",
        created_at: new Date(),
      };
      
      const ownerStream = await t.one<StreamDbRow>(
        `${sql.insert("stream", streamParams)} RETURNING *`,
        streamParams,
      );

      // Write initial owner record with snake_case parameters
      const ownerContent = { owner: userId };
      const timestamp = new Date().toISOString();
      const hash = calculateRecordHash(null, timestamp, ownerContent);

      const recordParams = {
        stream_id: ownerStream.id,
        index: 0,
        content: JSON.stringify(ownerContent),
        content_type: "application/json",
        name: "owner",
        hash: hash,
        previous_hash: null,
        user_id: userId,
        created_at: timestamp,
      };
      
      await t.none(
        sql.insert("record", recordParams),
        recordParams,
      );

      logger.info("Pod created", { podName, userId });
      const mappedPod = mapPodFromDb(pod);
      mappedPod.user_id = userId; // Set owner from what we just wrote
      return { success: true, data: mappedPod };
    });
  } catch (error: any) {
    logger.error("Failed to create pod", { error, podName });
    return {
      success: false,
      error: {
        code: "DATABASE_ERROR",
        message: "Failed to create pod",
      },
    };
  }
}

/**
 * Get pod by ID
 */
export async function getPod(
  db: Database,
  podName: string,
): Promise<Result<Pod>> {
  try {
    const pod = await db.oneOrNone<PodDbRow>(
      `SELECT * FROM pod WHERE name = $(podName)`,
      { podName },
    );

    if (!pod) {
      return {
        success: false,
        error: {
          code: "POD_NOT_FOUND",
          message: "Pod not found",
        },
      };
    }

    const mappedPod = mapPodFromDb(pod);

    // Get owner from .meta/owner stream
    const ownerResult = await getPodOwner(db, podName);
    if (ownerResult.success) {
      mappedPod.user_id = ownerResult.data;
    }

    return { success: true, data: mappedPod };
  } catch (error: any) {
    logger.error("Failed to get pod", { error, podName });
    return {
      success: false,
      error: {
        code: "DATABASE_ERROR",
        message: "Failed to get pod",
      },
    };
  }
}

/**
 * Get pod owner from .meta/owner stream
 */
export async function getPodOwner(
  db: Database,
  podName: string,
): Promise<Result<string>> {
  try {
    const record = await db.oneOrNone<RecordDbRow>(
      `SELECT r.*
       FROM record r
       JOIN stream s ON s.id = r.stream_id
       JOIN pod p ON p.id = s.pod_id
       WHERE p.name = $(podName)
         AND s.stream_id = '.meta/owner'
       ORDER BY r.created_at DESC
       LIMIT 1`,
      { podName },
    );

    if (!record) {
      return {
        success: false,
        error: {
          code: "OWNER_NOT_FOUND",
          message: "Pod owner not found",
        },
      };
    }

    const content =
      typeof record.content === "string"
        ? JSON.parse(record.content)
        : record.content;

    return { success: true, data: content.owner };
  } catch (error: any) {
    logger.error("Failed to get pod owner", { error, podName });
    return {
      success: false,
      error: {
        code: "DATABASE_ERROR",
        message: "Failed to get pod owner",
      },
    };
  }
}

/**
 * Transfer pod ownership
 */
export async function transferPodOwnership(
  db: Database,
  podName: string,
  currentUserId: string,
  newOwnerId: string,
): Promise<Result<void>> {
  try {
    return await db.tx(async (t) => {
      // Check current ownership
      const ownerResult = await getPodOwner(t as any, podName);
      if (!ownerResult.success || ownerResult.data !== currentUserId) {
        return {
          success: false,
          error: {
            code: "FORBIDDEN",
            message: "Only pod owner can transfer ownership",
          },
        };
      }

      // Get .meta/owner stream
      const ownerStream = await t.oneOrNone<StreamDbRow>(
        `SELECT s.*
         FROM stream s
         JOIN pod p ON p.id = s.pod_id
         WHERE p.name = $(podName)
           AND s.stream_id = '.meta/owner'`,
        { podName },
      );

      if (!ownerStream) {
        return {
          success: false,
          error: {
            code: "STREAM_NOT_FOUND",
            message: ".meta/owner stream not found",
          },
        };
      }

      // Get last record for hash chain
      const lastRecord = await t.oneOrNone<RecordDbRow>(
        `SELECT * FROM record
         WHERE stream_id = $(streamId)
         ORDER BY index DESC
         LIMIT 1`,
        { streamId: ownerStream.id },
      );

      // Write new owner record
      const ownerContent = { owner: newOwnerId };
      const timestamp = new Date().toISOString();
      const hash = calculateRecordHash(
        lastRecord?.hash || null,
        timestamp,
        ownerContent,
      );

      await t.none(
        `INSERT INTO record (stream_id, index, content, content_type, name, hash, previous_hash, user_id, created_at)
         VALUES ($(streamId), $(index), $(content), 'application/json', $(name), $(hash), $(previousHash), $(userId), $(timestamp))`,
        {
          streamId: ownerStream.id,
          index: (lastRecord?.index || 0) + 1,
          content: JSON.stringify(ownerContent),
          name: `owner-${(lastRecord?.index || 0) + 1}`,
          hash,
          previousHash: lastRecord?.hash || null,
          userId: currentUserId,
          timestamp,
        },
      );

      logger.info("Pod ownership transferred", {
        podName,
        from: currentUserId,
        to: newOwnerId,
      });
      return { success: true, data: undefined };
    });
  } catch (error: any) {
    logger.error("Failed to transfer pod ownership", { error, podName });
    return {
      success: false,
      error: {
        code: "DATABASE_ERROR",
        message: "Failed to transfer ownership",
      },
    };
  }
}

/**
 * Delete pod and all its streams
 */
export async function deletePod(
  db: Database,
  podName: string,
  userId: string,
): Promise<Result<void>> {
  try {
    return await db.tx(async (t) => {
      // Check ownership
      const ownerResult = await getPodOwner(t as any, podName);
      if (!ownerResult.success || ownerResult.data !== userId) {
        return {
          success: false,
          error: {
            code: "FORBIDDEN",
            message: "Only pod owner can delete pod",
          },
        };
      }

      // Get pod
      const pod = await t.oneOrNone<PodDbRow>(
        `SELECT * FROM pod WHERE name = $(podName)`,
        { podName },
      );

      if (!pod) {
        return {
          success: false,
          error: {
            code: "POD_NOT_FOUND",
            message: "Pod not found",
          },
        };
      }

      // Delete custom domains
      await t.none(`DELETE FROM custom_domain WHERE pod_id = $(podId)`, {
        podId: pod.id,
      });

      // Delete pod (cascades to streams and records)
      await t.none(`DELETE FROM pod WHERE id = $(podId)`, { podId: pod.id });

      logger.info("Pod deleted", { podName, userId });
      return { success: true, data: undefined };
    });
  } catch (error: any) {
    logger.error("Failed to delete pod", { error, podName });
    return {
      success: false,
      error: {
        code: "DATABASE_ERROR",
        message: "Failed to delete pod",
      },
    };
  }
}

/**
 * List all streams in a pod
 */
export async function listPodStreams(
  db: Database,
  podName: string,
): Promise<Result<Stream[]>> {
  try {
    const pod = await db.oneOrNone<PodDbRow>(
      `SELECT * FROM pod WHERE name = $(podName)`,
      { podName },
    );

    if (!pod) {
      return {
        success: false,
        error: {
          code: "POD_NOT_FOUND",
          message: "Pod not found",
        },
      };
    }

    const streams = await db.manyOrNone<StreamDbRow>(
      `SELECT * FROM stream 
       WHERE pod_id = $(podId)
       ORDER BY created_at ASC`,
      { podId: pod.id },
    );

    return { success: true, data: streams.map(mapStreamFromDb) };
  } catch (error: any) {
    logger.error("Failed to list pod streams", { error, podName });
    return {
      success: false,
      error: {
        code: "DATABASE_ERROR",
        message: "Failed to list streams",
      },
    };
  }
}
