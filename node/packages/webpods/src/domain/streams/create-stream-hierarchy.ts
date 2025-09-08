/**
 * Create a stream hierarchy by creating all parent streams if needed
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { createError } from "../../utils/errors.js";
import { Stream } from "../../types.js";
import { StreamDbRow } from "../../db-types.js";
import {
  parseStreamPath,
  isValidStreamName,
} from "../../utils/stream-utils.js";
import { createStream, mapStreamFromDb } from "./create-stream.js";
import { getStreamByPath } from "./get-stream-by-path.js";
import { createLogger } from "../../logger.js";

const logger = createLogger("webpods:domain:streams");

/**
 * Create a stream hierarchy, creating parent streams as needed
 * @param ctx Data context
 * @param podName Pod name
 * @param path Full path like "/blog/posts/2024"
 * @param userId User creating the streams
 * @param accessPermission Access permission for leaf stream (parents inherit)
 */
export async function createStreamHierarchy(
  ctx: DataContext,
  podName: string,
  path: string,
  userId: string,
  accessPermission: string = "public",
): Promise<Result<Stream>> {
  const segments = parseStreamPath(path);

  // Handle root stream case
  if (segments.length === 0 || path === "/") {
    // Check if a root stream already exists
    const existingRoot = await ctx.db.oneOrNone<StreamDbRow>(
      `SELECT * FROM stream 
       WHERE pod_name = $(podName) 
         AND name = $(name) 
         AND parent_id IS NULL`,
      { podName, name: "/" },
    );

    if (existingRoot) {
      return success(mapStreamFromDb(existingRoot));
    }

    // Create root stream
    const createResult = await createStream(
      ctx,
      podName,
      "/",
      userId,
      null, // No parent for root
      accessPermission,
    );

    return createResult;
  }

  // Validate all segment names
  for (const segment of segments) {
    if (!isValidStreamName(segment)) {
      return failure(
        createError("INVALID_STREAM_NAME", `Invalid stream name: ${segment}`),
      );
    }
  }

  try {
    let parentId: number | null = null;
    let currentStream: Stream | null = null;

    // Create each level if it doesn't exist
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      if (!segment) continue; // TypeScript safety check
      const isLeaf = i === segments.length - 1;
      const currentPath = "/" + segments.slice(0, i + 1).join("/");

      // Check if this level already exists
      const existingResult = await getStreamByPath(ctx, podName, currentPath);

      if (existingResult.success) {
        currentStream = existingResult.data;
        parentId = currentStream.id;
        continue;
      }

      // Before creating a stream, check if a record with this name exists in the parent
      if (parentId !== null) {
        const recordCheck = await ctx.db.oneOrNone<{ id: number }>(
          `SELECT id FROM record 
           WHERE stream_id = $(streamId) 
             AND name = $(name)
           LIMIT 1`,
          { streamId: parentId, name: segment },
        );

        if (recordCheck) {
          return failure(
            createError(
              "NAME_CONFLICT",
              `Cannot create stream '${segment}': a record with this name already exists in the parent stream`,
            ),
          );
        }
      }

      // Create this level
      // Use provided access permission for leaf, inherit parent's for intermediate levels
      const streamAccessPermission = isLeaf ? accessPermission : "public";

      const createResult = await createStream(
        ctx,
        podName,
        segment,
        userId,
        parentId || null,
        streamAccessPermission,
      );

      if (!createResult.success) {
        return createResult;
      }

      currentStream = createResult.data;
      parentId = currentStream.id;
    }

    if (!currentStream) {
      return failure(
        createError("CREATE_ERROR", "Failed to create stream hierarchy"),
      );
    }

    logger.info("Stream hierarchy created", {
      podName,
      path,
      streamId: currentStream.id,
      userId,
    });

    return success(currentStream);
  } catch (error: unknown) {
    logger.error("Failed to create stream hierarchy", { error, podName, path });
    return failure(
      createError("CREATE_ERROR", "Failed to create stream hierarchy"),
    );
  }
}
