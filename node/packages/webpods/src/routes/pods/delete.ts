/**
 * Main DELETE handler for content deletion
 */

import {
  Response,
  NextFunction,
  AuthRequest,
  authenticate,
  extractPod,
  createRouteLogger,
  isSystemStream,
  CodedError,
} from "./shared.js";
import { getDb } from "../../db/index.js";
import { getStreamById } from "../../domain/streams/get-stream-by-id.js";
import { resolvePath } from "../../domain/resolution/resolve-path.js";
import { deleteStream } from "../../domain/streams/delete-stream.js";
import { purgeRecord } from "../../domain/records/purge-record.js";
import { deleteRecord } from "../../domain/records/delete-record.js";
import { getPodOwner } from "../../domain/pods/get-pod-owner.js";

const logger = createRouteLogger("delete");

/**
 * Delete records or streams
 * DELETE {pod}.webpods.org/{stream_path} - Delete stream
 * DELETE {pod}.webpods.org/{stream_path}/{name} - Delete record
 * DELETE {pod}.webpods.org/{stream_path}/{name}?purge=true - Purge record
 */
export const deleteHandler = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  // If no pod_id was extracted, this is the main domain - skip to next handler
  if (!req.podName) {
    return next();
  }

  if (!req.auth) {
    res.status(401).json({
      error: {
        code: "UNAUTHORIZED",
        message: "Authentication required",
      },
    });
    return;
  }

  const db = getDb();
  const fullPath = req.path.substring(1); // Remove leading /
  const purge = req.query.purge === "true";

  // Use path resolution to determine if this is a stream or record
  const resolutionResult = await resolvePath(
    { db },
    req.podName,
    fullPath,
    false, // No index query for DELETE
  );

  if (!resolutionResult.success) {
    res.status(404).json({
      error: {
        code: (resolutionResult.error as any).code || "NOT_FOUND",
        message: resolutionResult.error.message,
      },
    });
    return;
  }

  const streamId = resolutionResult.data.streamId;
  const streamPath = resolutionResult.data.streamPath;
  const recordName = resolutionResult.data.recordName;

  // Prevent deletion of system streams via this endpoint
  if (!recordName && isSystemStream(streamPath)) {
    res.status(403).json({
      error: {
        code: "FORBIDDEN",
        message: "System streams cannot be deleted",
      },
    });
    return;
  }

  // Check ownership - only pod owner can delete
  const ownerResult = await getPodOwner({ db }, req.podName);
  if (!ownerResult.success || ownerResult.data !== req.auth.user_id) {
    res.status(403).json({
      error: {
        code: "FORBIDDEN",
        message: "Only pod owner can delete streams or records",
      },
    });
    return;
  }

  if (recordName) {
    // Delete or purge a record
    // Stream already resolved, get it by ID
    const streamResult = await getStreamById({ db }, streamId);

    if (!streamResult.success) {
      res.status(404).json({
        error: {
          code: "STREAM_NOT_FOUND",
          message: `Stream not found`,
        },
      });
      return;
    }

    if (purge) {
      // Hard delete - physically overwrite the content
      const purgeResult = await purgeRecord(
        { db },
        streamId,
        recordName,
        req.auth.user_id,
      );

      if (!purgeResult.success) {
        res.status(404).json({
          error: purgeResult.error,
        });
        return;
      }

      logger.info("Record purged", {
        podId: req.podName,
        streamPath,
        recordName,
        userId: req.auth.user_id,
      });
      res.status(204).send();
    } else {
      // Soft delete - add a tombstone record
      const deleteResult = await deleteRecord(
        { db },
        streamId,
        recordName,
        req.auth.user_id,
      );

      if (!deleteResult.success) {
        res.status(500).json({
          error: deleteResult.error,
        });
        return;
      }

      logger.info("Record soft deleted", {
        podId: req.podName,
        streamPath,
        recordName,
        tombstoneName: deleteResult.data.name,
        userId: req.auth.user_id,
      });
      res.status(204).send();
    }
  } else {
    // Delete entire stream
    const result = await deleteStream(
      { db },
      req.podName,
      streamId,
      req.auth!.user_id,
    );

    if (!result.success) {
      const status =
        (result.error as CodedError).code === "FORBIDDEN"
          ? 403
          : (result.error as CodedError).code === "NOT_FOUND"
            ? 404
            : 500;
      res.status(status).json({
        error: result.error,
      });
      return;
    }

    res.status(204).send();
  }
};

export const deleteRoute = {
  path: "/*",
  middleware: [extractPod, authenticate] as const,
  handler: deleteHandler,
};
