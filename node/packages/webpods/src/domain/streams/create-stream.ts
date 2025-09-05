/**
 * Create a stream explicitly
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { StreamDbRow, RecordDbRow } from "../../db-types.js";
import { Stream } from "../../types.js";
import { isValidStreamId } from "../../utils.js";
import { createLogger } from "../../logger.js";
import { sql } from "../../db/index.js";
import { createError } from "../../utils/errors.js";

const logger = createLogger("webpods:domain:streams");

/**
 * Map database row to domain type
 */
function mapStreamFromDb(row: StreamDbRow): Stream {
  return {
    podName: row.pod_name,
    name: row.name,
    userId: row.user_id,
    accessPermission: row.access_permission,
    metadata: row.metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at,
  };
}

export async function createStream(
  ctx: DataContext,
  podName: string,
  streamName: string,
  userId: string,
  accessPermission: string = "public",
): Promise<Result<Stream>> {
  // Validate stream ID
  if (!isValidStreamId(streamName)) {
    return failure(createError("INVALID_STREAM_ID", "Invalid stream ID"));
  }

  try {
    // Check if stream already exists
    const existingStream = await ctx.db.oneOrNone<StreamDbRow>(
      `SELECT * FROM stream 
       WHERE pod_name = $(pod_name) 
         AND name = $(name)`,
      { pod_name: podName, name: streamName },
    );

    if (existingStream) {
      return failure(
        createError("STREAM_EXISTS", `Stream '${streamName}' already exists`),
      );
    }

    // Check if user is the pod owner
    const ownerRecord = await ctx.db.oneOrNone<RecordDbRow>(
      `SELECT r.* FROM record r
       WHERE r.pod_name = $(pod_name)
         AND r.stream_name = '.config/owner'
         AND r.name = 'owner'
       ORDER BY r.index DESC
       LIMIT 1`,
      { pod_name: podName },
    );

    if (ownerRecord) {
      try {
        const content = JSON.parse(ownerRecord.content);
        const podOwner = content.owner;

        // Only the pod owner can create new streams
        if (podOwner !== userId) {
          logger.warn("Non-owner attempted to create stream", {
            podName,
            streamName,
            userId,
            ownerId: podOwner,
          });
          return failure(
            createError(
              "FORBIDDEN",
              "Only the pod owner can create new streams",
            ),
          );
        }
      } catch {
        // If we can't parse owner record, allow creation (backwards compatibility)
        logger.warn("Failed to parse owner record, allowing stream creation", {
          podName,
        });
      }
    }

    // Create new stream
    const params = {
      pod_name: podName,
      name: streamName,
      user_id: userId,
      access_permission: accessPermission,
      created_at: new Date(),
    };

    const stream = await ctx.db.one<StreamDbRow>(
      `${sql.insert("stream", params)} RETURNING *`,
      params,
    );

    logger.info("Stream created", {
      podName: stream.pod_name,
      streamName: stream.name,
      userId,
    });

    return success(mapStreamFromDb(stream));
  } catch (error: unknown) {
    logger.error("Failed to create stream", {
      error,
      podName,
      streamName,
    });
    return failure(
      createError(
        "CREATE_ERROR",
        (error as Error).message || "Failed to create stream",
      ),
    );
  }
}
