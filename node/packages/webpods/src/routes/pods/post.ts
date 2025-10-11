/**
 * Main POST handler for content creation
 */

import { z } from "zod";
import {
  Response,
  NextFunction,
  AuthRequest,
  writeMiddleware,
  createRouteLogger,
  detectContentType,
  isValidName,
  CodedError,
} from "./shared.js";
import { getDb } from "../../db/index.js";
import { getStreamById } from "../../domain/streams/get-stream-by-id.js";
import { getStreamByPath } from "../../domain/streams/get-stream-by-path.js";
import { createStreamHierarchy } from "../../domain/streams/create-stream-hierarchy.js";
import { updateStreamPermission } from "../../domain/streams/update-stream-permission.js";
import { resolvePathForWrite } from "../../domain/resolution/resolve-path.js";
import { writeRecord } from "../../domain/records/write-record.js";
import { writeResultToResponse } from "../../domain/records/record-to-response.js";
import { canWrite } from "../../domain/permissions/can-write.js";
import { getPodOwner } from "../../domain/pods/get-pod-owner.js";
import { getRateLimiter } from "../../ratelimit/index.js";
import {
  validateAgainstSchema,
  updateSchemaFlag,
} from "../../domain/schema/validate-schema.js";
import { getConfig } from "../../config-loader.js";

const logger = createRouteLogger("post");

/**
 * Write to stream with required name
 * POST {pod}.webpods.org/{stream_path}/{name}
 * Example: POST alice.webpods.org/blog/posts/first.md
 */
export const postHandler = async (
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

  try {
    // Extract stream path and name from URL
    const fullPath = req.path.substring(1); // Remove leading /
    const db = getDb();

    // DOUBLE PROTECTION: Explicitly block writes to protected .config streams
    // These streams should ONLY be modified through their specific API endpoints
    const PROTECTED_CONFIG_STREAMS = [
      { path: ".config/owner", endpoint: "POST /.config/owner" },
      { path: ".config/routing", endpoint: "POST /.config/routing" },
      { path: ".config/domains", endpoint: "POST /.config/domains" },
    ];

    // Block ALL writes to protected streams and their children
    for (const protectedStream of PROTECTED_CONFIG_STREAMS) {
      if (
        fullPath === protectedStream.path ||
        fullPath.startsWith(protectedStream.path + "/")
      ) {
        logger.warn("BLOCKED: Attempt to write to protected config stream", {
          fullPath,
          protectedPath: protectedStream.path,
          podName: req.podName,
          userId: req.auth?.user_id,
        });
        res.status(403).json({
          error: {
            code: "FORBIDDEN",
            message: `Direct writes to ${protectedStream.path} are not allowed. Use ${protectedStream.endpoint} API endpoint instead.`,
          },
        });
        return;
      }
    }

    // Check if this is a POST with empty body to create a stream
    const isEmptyBody =
      !req.body ||
      (typeof req.body === "object" &&
        !Array.isArray(req.body) &&
        Object.keys(req.body).length === 0);

    // For empty body POSTs, we're creating a stream without a record
    if (isEmptyBody) {
      // The full path is the stream ID
      if (!fullPath) {
        res.status(400).json({
          error: {
            code: "INVALID_REQUEST",
            message: "Stream path is required",
          },
        });
        return;
      }

      const streamPath = fullPath;
      const accessPermission = req.query.access as string | undefined;

      // Check if pod exists
      if (!req.pod) {
        res.status(404).json({
          error: {
            code: "POD_NOT_FOUND",
            message: `Pod '${req.podName}' does not exist. Create it first using the pod creation API.`,
          },
        });
        return;
      }

      // Check if stream already exists
      const existingStream = await getStreamByPath(
        { db },
        req.podName,
        streamPath,
      );
      if (existingStream.success) {
        res.status(409).json({
          error: {
            code: "STREAM_ALREADY_EXISTS",
            message: `Stream '${streamPath}' already exists`,
          },
        });
        return;
      }

      // Check if this is a .config/* stream - only pod owner can create these
      if (streamPath.startsWith(".config/")) {
        const ownerResult = await getPodOwner({ db }, req.podName);
        if (ownerResult.success && ownerResult.data !== req.auth.user_id) {
          res.status(403).json({
            error: {
              code: "FORBIDDEN",
              message: "Only pod owner can create .config/* streams",
            },
          });
          return;
        }
      }

      // Check rate limit for stream creation
      const rateLimiter = getRateLimiter();
      if (rateLimiter) {
        const streamLimitResult = await rateLimiter.checkAndIncrement(
          req.auth.user_id,
          "stream_create",
        );

        if (!streamLimitResult.allowed) {
          res.status(429).json({
            error: {
              code: "RATE_LIMIT_EXCEEDED",
              message: "Too many streams created",
            },
          });
          return;
        }
      }

      // Create the stream hierarchy
      const createResult = await createStreamHierarchy(
        { db },
        req.podName,
        streamPath,
        req.auth.user_id,
        accessPermission || "public",
      );

      if (!createResult.success) {
        res.status(500).json({
          error: createResult.error,
        });
        return;
      }

      // Note: stream_create rate limit was already incremented above

      res.status(201).json({ success: true });
      return;
    }

    // Regular POST with content - writing a record

    // Check for trailing slash which means empty name
    if (fullPath.endsWith("/") || fullPath === "") {
      res.status(400).json({
        error: {
          code: "MISSING_NAME",
          message: "Record name is required",
        },
      });
      return;
    }

    const pathParts = fullPath.split("/");

    // Last segment is always the name (required)
    if (pathParts.length === 0 || !pathParts[pathParts.length - 1]) {
      res.status(400).json({
        error: {
          code: "MISSING_NAME",
          message: "Record name is required",
        },
      });
      return;
    }

    const name = pathParts.pop()!;

    // Express might normalize single dot to empty, check for this
    if (!name || name === "") {
      res.status(400).json({
        error: {
          code: "MISSING_NAME",
          message: "Record name is required",
        },
      });
      return;
    }

    // Validate name early to provide better error messages
    if (!isValidName(name)) {
      res.status(400).json({
        error: {
          code: "INVALID_NAME",
          message:
            "Name can only contain letters, numbers, hyphens, underscores, and periods. Cannot start or end with a period.",
        },
      });
      return;
    }

    const streamPath = pathParts.length > 0 ? pathParts.join("/") : "/"; // Use '/' for root stream
    logger.debug("Stream ID for writing", { pathParts, streamPath, fullPath });
    const content = req.body; // Already parsed by Express middleware
    const contentType = detectContentType(req.headers);
    const accessPermission = req.query.access as string | undefined;

    // Check if pod exists - require explicit creation via POST /api/pods
    if (!req.pod) {
      res.status(404).json({
        error: {
          code: "POD_NOT_FOUND",
          message: `Pod '${req.podName}' does not exist. Create it first using the pod creation API.`,
        },
      });
      return;
    }

    // Try to resolve the path for writing
    const resolutionResult = await resolvePathForWrite(
      { db },
      req.podName,
      fullPath,
    );

    let streamId: number;
    let resolvedStreamPath: string;

    if (!resolutionResult.success) {
      // Stream doesn't exist, need to create it
      // Check rate limit before creating
      const rateLimiter = getRateLimiter();
      if (rateLimiter) {
        const streamLimitResult = await rateLimiter.checkAndIncrement(
          req.auth.user_id,
          "stream_create",
        );

        if (!streamLimitResult.allowed) {
          res.status(429).json({
            error: {
              code: "RATE_LIMIT_EXCEEDED",
              message: "Too many streams created",
            },
          });
          return;
        }
      }

      // Create the stream hierarchy
      const createResult = await createStreamHierarchy(
        { db },
        req.podName,
        streamPath,
        req.auth!.user_id,
        accessPermission || "public",
      );

      if (!createResult.success) {
        let status = 500;
        const errorCode = (createResult.error as CodedError).code;
        if (errorCode === "FORBIDDEN") {
          status = 403;
        } else if (
          errorCode === "NAME_CONFLICT" ||
          errorCode === "STREAM_EXISTS"
        ) {
          status = 409;
        }
        res.status(status).json({
          error: createResult.error,
        });
        return;
      }

      streamId = createResult.data.id;
      resolvedStreamPath = streamPath;
    } else {
      // Stream exists, use resolved values
      streamId = resolutionResult.data.streamId;
      resolvedStreamPath = resolutionResult.data.streamPath;
      // Verify the record name matches what we expected
      if (resolutionResult.data.recordName !== name) {
        res.status(400).json({
          error: {
            code: "INVALID_PATH",
            message: "Path resolution mismatch",
          },
        });
        return;
      }

      // If access parameter is provided and stream exists, update its permissions
      // But only if the user is the stream creator
      if (accessPermission) {
        // Get the stream to check creator
        const streamCheck = await getStreamById({ db }, streamId);
        if (
          streamCheck.success &&
          streamCheck.data.userId === req.auth.user_id
        ) {
          const updateResult = await updateStreamPermission(
            { db },
            streamId,
            accessPermission,
          );
          if (!updateResult.success) {
            logger.warn("Failed to update stream permission", {
              error: updateResult.error,
              streamId,
              accessPermission,
            });
            // Don't fail the request, just log the warning
          }
        }
      }
    }

    // Get the stream by ID for permission checking
    const streamResult = await getStreamById({ db }, streamId);

    if (!streamResult.success) {
      res.status(500).json({
        error: streamResult.error,
      });
      return;
    }

    // Note: stream_create rate limit was already incremented above if stream was created

    // Check if this is a .config/* stream - only pod owner can write to these
    if (resolvedStreamPath.startsWith(".config/")) {
      const ownerResult = await getPodOwner({ db }, req.podName);
      if (ownerResult.success && ownerResult.data !== req.auth.user_id) {
        res.status(403).json({
          error: {
            code: "FORBIDDEN",
            message: "Only pod owner can write to .config/* streams",
          },
        });
        return;
      }
    } else {
      // For non-.config streams, check regular write permissions
      const canWriteResult = await canWrite(
        { db },
        streamResult.data,
        req.auth.user_id,
      );
      if (!canWriteResult) {
        res.status(403).json({
          error: {
            code: "FORBIDDEN",
            message: "No write permission for this stream",
          },
        });
        return;
      }
    }

    // Validate against schema if present
    const validationResult = await validateAgainstSchema(
      { db },
      streamResult.data,
      content,
    );

    if (!validationResult.success) {
      res.status(400).json({
        error: validationResult.error,
      });
      return;
    }

    // Check if this is a file-type record that should use optimized storage
    const useExternalStorage = req.headers["x-record-type"] === "file";

    // Extract custom headers with x-record-header- prefix
    const config = getConfig();
    const allowedHeaders = config.server.allowedRecordHeaders || [];

    const customHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (key.startsWith("x-record-header-") && typeof value === "string") {
        const headerName = key.substring("x-record-header-".length);
        // Check if this header is allowed
        if (allowedHeaders.includes(headerName)) {
          customHeaders[headerName] = value;
        }
      }
    }

    // Write record
    const recordResult = await writeRecord(
      { db },
      streamId,
      content,
      contentType,
      req.auth.user_id,
      name,
      useExternalStorage,
      customHeaders,
    );

    if (!recordResult.success) {
      // Check for specific error codes
      let status = 500;
      if ((recordResult.error as CodedError).code === "NAME_EXISTS") {
        status = 409;
      } else if ((recordResult.error as CodedError).code === "NAME_CONFLICT") {
        status = 409;
      } else if ((recordResult.error as CodedError).code === "INVALID_NAME") {
        status = 400;
      }

      res.status(status).json({
        error: recordResult.error,
      });
      return;
    }

    // If we just wrote to a .config/schema stream, update the parent stream's has_schema flag
    if (name === "schema" && resolvedStreamPath.endsWith("/.config")) {
      try {
        const contentStr =
          typeof content === "string" ? content : JSON.stringify(content);
        const schemaDef = JSON.parse(contentStr);
        await updateSchemaFlag(
          { db },
          resolvedStreamPath,
          req.podName,
          schemaDef,
        );
      } catch (err) {
        // Log but don't fail the request - the record was already written
        console.error("Failed to update schema flag:", err);
      }
    }

    res
      .status(201)
      .json(writeResultToResponse(recordResult.data, resolvedStreamPath));
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: {
          code: "INVALID_INPUT",
          message: "Invalid request",
          details: error.issues,
        },
      });
      return;
    }
    logger.error("Write error", { error });
    res.status(500).json({
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error",
      },
    });
  }
};

export const postRoute = {
  path: "/*",
  middleware: writeMiddleware,
  handler: postHandler,
};
