/**
 * Get or create a stream hierarchy
 */

import { DataContext } from "../data-context.js";
import { Result, success } from "../../utils/result.js";
import { Stream } from "../../types.js";
import { createLogger } from "../../logger.js";
import { getStreamByPath } from "./get-stream-by-path.js";
import { createStreamHierarchy } from "./create-stream-hierarchy.js";
import { updateStreamPermissions } from "./update-stream-permissions.js";

const logger = createLogger("webpods:domain:streams");

export async function getOrCreateStream(
  ctx: DataContext,
  podName: string,
  streamPath: string,
  userId: string,
  accessPermission?: string,
): Promise<Result<{ stream: Stream; created: boolean; updated?: boolean }>> {
  try {
    // Try to find existing stream by path
    const existingResult = await getStreamByPath(ctx, podName, streamPath);

    if (existingResult.success) {
      const stream = existingResult.data;

      // Check if permissions need to be updated
      if (accessPermission && accessPermission !== stream.accessPermission) {
        // Only the creator can update permissions
        if (stream.userId !== userId) {
          logger.warn("Non-creator attempted to update stream permissions", {
            podName,
            streamPath,
            userId,
            creatorId: stream.userId,
          });
          // Return the existing stream without updating
          return success({
            stream,
            created: false,
            updated: false,
          });
        }

        // Update the stream permissions
        const updateResult = await updateStreamPermissions(
          ctx,
          podName,
          stream.name,
          accessPermission,
        );

        if (!updateResult.success) {
          logger.error("Failed to update stream permissions", {
            podName,
            streamPath,
            error: updateResult.error,
          });
          // Return the existing stream even if update fails
          return success({
            stream,
            created: false,
            updated: false,
          });
        }

        // Get the updated stream
        const updatedResult = await getStreamByPath(ctx, podName, streamPath);
        if (updatedResult.success) {
          return success({
            stream: updatedResult.data,
            created: false,
            updated: true,
          });
        }
      }

      return success({
        stream,
        created: false,
      });
    }

    // Stream doesn't exist - create the hierarchy
    const createResult = await createStreamHierarchy(
      ctx,
      podName,
      streamPath,
      userId,
      accessPermission || "public",
    );

    if (!createResult.success) {
      return createResult as any;
    }

    logger.info("Stream hierarchy created", {
      podName,
      streamPath,
      userId,
    });

    return success({
      stream: createResult.data,
      created: true,
    });
  } catch (error: unknown) {
    logger.error("Failed to get or create stream", {
      error,
      podName,
      streamPath,
    });
    return {
      success: false,
      error: new Error("Failed to get or create stream"),
    } as any;
  }
}
