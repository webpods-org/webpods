/**
 * Path resolution for WebPods URLs
 * Determines if a path points to a stream or a record within a stream
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { createError } from "../../utils/errors.js";
import { getStreamByPath } from "../streams/get-stream-by-path.js";
import { createLogger } from "../../logger.js";
import { StreamDbRow } from "../../db-types.js";

const logger = createLogger("webpods:domain:resolution");

export interface PathResolution {
  streamId: number; // The resolved stream ID
  streamPath: string; // The stream path
  recordName?: string; // Optional record name if path points to a record
  isStream: boolean; // True if path points to a stream, false if to a record
}

/**
 * Resolve a path to determine if it's a stream or a record
 *
 * Resolution strategy:
 * 1. If using index query (?i=), entire path is a stream
 * 2. For multi-segment paths, check if full path is a stream first
 * 3. If not a stream, treat last segment as record name
 *
 * @param ctx Database context
 * @param podName Pod name
 * @param path Path to resolve (e.g., "a/b/c/d")
 * @param hasIndexQuery Whether the request has an index query parameter
 * @returns Resolution result with stream ID and optional record name
 */
export async function resolvePath(
  ctx: DataContext,
  podName: string,
  path: string,
  hasIndexQuery: boolean = false,
): Promise<Result<PathResolution>> {
  try {
    const pathParts = path.split("/").filter(Boolean);

    if (pathParts.length === 0) {
      return failure(createError("INVALID_PATH", "Empty path"));
    }

    logger.debug("Resolving path", { podName, path, pathParts, hasIndexQuery });

    // If using index query, entire path must be a stream
    if (hasIndexQuery) {
      const streamResult = await getStreamByPath(ctx, podName, path);

      if (!streamResult.success) {
        return failure(
          createError("STREAM_NOT_FOUND", `Stream not found: ${path}`),
        );
      }

      return success({
        streamId: streamResult.data.id,
        streamPath: path,
        isStream: true,
      });
    }

    // For single-segment paths, it's always a stream
    if (pathParts.length === 1) {
      const streamResult = await getStreamByPath(ctx, podName, path);

      if (!streamResult.success) {
        return failure(
          createError("STREAM_NOT_FOUND", `Stream not found: ${path}`),
        );
      }

      return success({
        streamId: streamResult.data.id,
        streamPath: path,
        isStream: true,
      });
    }

    // For multi-segment paths, try full path as stream first
    const fullStreamResult = await getStreamByPath(ctx, podName, path);

    if (fullStreamResult.success) {
      // Full path is a stream
      return success({
        streamId: fullStreamResult.data.id,
        streamPath: path,
        isStream: true,
      });
    }

    // Full path is not a stream, try as stream + record
    const recordName = pathParts.pop();
    const streamPath = pathParts.join("/");

    const streamResult = await getStreamByPath(ctx, podName, streamPath);

    if (!streamResult.success) {
      // Neither interpretation works
      return failure(
        createError(
          "NOT_FOUND",
          `Not found: no stream '${path}' and no stream '${streamPath}' with record '${recordName}'`,
        ),
      );
    }

    // Found as stream + record
    return success({
      streamId: streamResult.data.id,
      streamPath,
      recordName,
      isStream: false,
    });
  } catch (error: unknown) {
    logger.error("Failed to resolve path", { error, podName, path });
    return failure(createError("RESOLUTION_ERROR", "Failed to resolve path"));
  }
}

/**
 * Resolve a path for write operations
 * For writes, the last segment is always treated as the record name
 *
 * @param ctx Database context
 * @param podName Pod name
 * @param path Path to resolve (e.g., "a/b/c/d")
 * @returns Resolution result with stream ID and record name
 */
export async function resolvePathForWrite(
  ctx: DataContext,
  podName: string,
  path: string,
): Promise<Result<PathResolution & { recordName: string }>> {
  try {
    const pathParts = path.split("/").filter(Boolean);

    if (pathParts.length === 0) {
      return failure(createError("INVALID_PATH", "Empty path"));
    }

    logger.debug("Resolving path for write", { podName, path, pathParts });

    // Last part is always the record name for writes
    const recordName = pathParts.pop()!;
    const streamPath = pathParts.length > 0 ? pathParts.join("/") : "/";

    // Special case for root stream
    if (streamPath === "/") {
      // Check if a root stream exists
      const rootStream = await ctx.db.oneOrNone<StreamDbRow>(
        `SELECT * FROM stream 
         WHERE pod_name = $(podName) 
           AND name = $(name) 
           AND parent_id IS NULL`,
        { podName, name: "/" },
      );
      
      if (!rootStream) {
        // Root stream doesn't exist - need to create it
        return failure(
          createError("STREAM_NOT_FOUND", "Root stream not found"),
        );
      }
      
      return success({
        streamId: rootStream.id,
        streamPath: "/",
        recordName,
        isStream: false,
      });
    }

    const streamResult = await getStreamByPath(ctx, podName, streamPath);

    if (!streamResult.success) {
      // Stream doesn't exist - this is okay for writes as we might create it
      // Return a special result indicating stream needs creation
      return failure(
        createError("STREAM_NOT_FOUND", `Stream not found: ${streamPath}`),
      );
    }

    return success({
      streamId: streamResult.data.id,
      streamPath,
      recordName,
      isStream: false,
    });
  } catch (error: unknown) {
    logger.error("Failed to resolve path for write", { error, podName, path });
    return failure(createError("RESOLUTION_ERROR", "Failed to resolve path"));
  }
}
