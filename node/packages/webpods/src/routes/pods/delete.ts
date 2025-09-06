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
import { getStream } from "../../domain/streams/get-stream.js";
import { deleteStream } from "../../domain/streams/delete-stream.js";
import { writeRecord } from "../../domain/records/write-record.js";
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
  const pathParts = req.path.substring(1).split("/"); // Remove leading /
  const purge = req.query.purge === "true";

  // Check if we're trying to delete a record or a stream
  // Similar logic to GET - check if full path is a stream first
  let streamPath: string;
  let recordName: string | undefined;

  if (pathParts.length > 1) {
    const fullPath = pathParts.join("/");
    const streamResult = await getStream({ db }, req.podName, fullPath);

    if (streamResult.success && streamResult.data) {
      // Full path is a stream, delete the stream
      streamPath = fullPath;
    } else {
      // Try as record in parent stream
      recordName = pathParts.pop();
      streamPath = pathParts.join("/");
    }
  } else {
    streamPath = pathParts[0]!;
  }

  // Prevent deletion of system streams via this endpoint
  if (!recordName && streamPath && isSystemStream(streamPath)) {
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
    const streamResult = await getStream({ db }, req.podName, streamPath);

    if (!streamResult.success || !streamResult.data) {
      const fullPath = req.path.substring(1);
      res.status(404).json({
        error: {
          code: "NOT_FOUND",
          message: `Not found: no stream '${fullPath}' and no stream '${streamPath}' with record '${recordName}'`,
        },
      });
      return;
    }

    if (purge) {
      // Hard delete - physically overwrite the content
      const updateResult = await db.result(
        `UPDATE record
         SET content = $(content),
             content_type = $(contentType)
         WHERE stream_id = $(streamId)
           AND name = $(recordName)`,
        {
          streamId: streamResult.data.id,
          recordName,
          content: JSON.stringify({
            deleted: true,
            purged: true,
            purgedAt: new Date().toISOString(),
            purgedBy: req.auth.user_id,
          }),
          contentType: "application/json",
        },
        (r) => r.rowCount,
      );

      if (updateResult === 0) {
        res.status(404).json({
          error: {
            code: "RECORD_NOT_FOUND",
            message: `Record '${recordName}' not found in stream '${streamPath}'`,
          },
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
      // Soft delete - add a tombstone record with a unique name
      // Get the next index for the tombstone
      const lastRecord = await db.oneOrNone(
        `SELECT * FROM record
         WHERE stream_id = $(streamId)
         ORDER BY index DESC
         LIMIT 1`,
        {
          streamId: streamResult.data.id,
        },
      );

      const nextIndex = (lastRecord?.index ?? -1) + 1;
      const tombstoneName = `${recordName}.deleted.${nextIndex}`;

      const deletionRecord = {
        deleted: true,
        deletedAt: new Date().toISOString(),
        deletedBy: req.auth.user_id,
        originalName: recordName,
      };

      const writeResult = await writeRecord(
        { db },
        streamResult.data.id,
        deletionRecord,
        "application/json",
        req.auth.user_id,
        tombstoneName,
      );

      if (!writeResult.success) {
        res.status(500).json({
          error: writeResult.error,
        });
        return;
      }

      logger.info("Record soft deleted", {
        podId: req.podName,
        streamPath,
        recordName,
        userId: req.auth.user_id,
      });
      res.status(204).send();
    }
  } else {
    // Delete entire stream
    // First get the stream to get its ID
    const streamResult = await getStream({ db }, req.podName, streamPath);

    if (!streamResult.success || !streamResult.data) {
      res.status(404).json({
        error: {
          code: "STREAM_NOT_FOUND",
          message: `Stream '${streamPath}' not found`,
        },
      });
      return;
    }

    const result = await deleteStream(
      { db },
      req.podName,
      streamResult.data.id,
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
