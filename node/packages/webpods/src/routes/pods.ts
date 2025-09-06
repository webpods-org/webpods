/**
 * Pod and stream routes
 */

import {
  Router,
  Request as ExpressRequest,
  Response,
  NextFunction,
} from "express";
import type { AuthRequest, StreamRecord } from "../types.js";
import type { CodedError } from "../utils/errors.js";
import { z } from "zod";
import {
  authenticateHybrid as authenticate,
  optionalAuthHybrid as optionalAuth,
} from "../middleware/hybrid-auth.js";
import { extractPod } from "../middleware/pod.js";
import { rateLimit } from "../middleware/ratelimit.js";
import { getDb } from "../db/index.js";
import { createLogger } from "../logger.js";
import { getConfig } from "../config-loader.js";
import {
  parseIndexQuery,
  detectContentType,
  isSystemStream,
  isBinaryContentType,
  isValidBase64,
  parseDataUrl,
  isValidName,
} from "../utils.js";

// Import domain functions
import { deletePod } from "../domain/pods/delete-pod.js";
import { listPodStreams } from "../domain/pods/list-pod-streams.js";
import { transferPodOwnership } from "../domain/pods/transfer-pod-ownership.js";
import { getPodOwner } from "../domain/pods/get-pod-owner.js";
import { getOrCreateStream } from "../domain/streams/get-or-create-stream.js";
import { getStream } from "../domain/streams/get-stream.js";
import { createStreamHierarchy } from "../domain/streams/create-stream-hierarchy.js";
import { deleteStream } from "../domain/streams/delete-stream.js";
import { writeRecord } from "../domain/records/write-record.js";
import { getRecord } from "../domain/records/get-record.js";
import { getRecordRange } from "../domain/records/get-record-range.js";
import { listRecords } from "../domain/records/list-records.js";
import { listUniqueRecords } from "../domain/records/list-unique-records.js";
import { listRecordsRecursive } from "../domain/records/list-records-recursive.js";
import { recordToResponse } from "../domain/records/record-to-response.js";
import { canRead } from "../domain/permissions/can-read.js";
import { canWrite } from "../domain/permissions/can-write.js";
import { resolveLink } from "../domain/routing/resolve-link.js";
import { updateLinks } from "../domain/routing/update-links.js";
import { updateCustomDomains } from "../domain/routing/update-custom-domains.js";
import { checkRateLimit } from "../domain/ratelimit/check-rate-limit.js";

const logger = createLogger("webpods:routes:pods");
const router = Router({ mergeParams: true });

// Validation schemas
const writeSchema = z.union([z.string(), z.object({}).passthrough()]);

const ownerSchema = z.object({
  owner: z.string(),
});

const linksSchema = z.record(z.string());

const domainsSchema = z.object({
  domains: z.array(z.string()),
});

/**
 * Pod-specific login endpoint
 * GET {pod}.webpods.org/login
 */
router.get("/login", extractPod, (req: ExpressRequest, res: Response) => {
  if (!req.podName) {
    res.status(400).json({
      error: {
        code: "INVALID_POD",
        message: "Could not determine pod from request",
      },
    });
    return;
  }

  // Get redirect path from query or referer
  const redirect = (req.query.redirect as string) || req.get("referer") || "/";

  // Redirect to main domain authorization with pod info
  const config = getConfig();
  const publicUrl = config.server.publicUrl || "http://localhost:3000";
  const authUrl = `${publicUrl}/auth/authorize?pod=${req.podName}&redirect=${encodeURIComponent(redirect)}`;

  logger.info("Pod login initiated", { pod: req.podName, redirect });
  res.redirect(authUrl);
});

/**
 * Pod-specific auth callback
 * GET {pod}.webpods.org/auth/callback
 */
router.get(
  "/auth/callback",
  extractPod,
  (req: ExpressRequest, res: Response) => {
    const token = req.query.token as string;
    const redirect = (req.query.redirect as string) || "/";

    logger.info("Auth callback on pod", {
      pod: req.podName,
      hasToken: !!token,
      redirect,
    });

    if (!token) {
      res.status(400).json({
        error: {
          code: "MISSING_TOKEN",
          message: "Authorization token is required",
        },
      });
      return;
    }

    // Set cookie for this pod subdomain
    const config = getConfig();
    const publicConfig = config.server.public;
    const isSecure = publicConfig?.isSecure || false;
    res.cookie("pod_token", token, {
      httpOnly: true,
      secure: isSecure,
      sameSite: isSecure ? "strict" : "lax",
      maxAge: 10 * 365 * 24 * 60 * 60 * 1000, // 10 years (effectively unlimited)
      path: "/",
      // Cookie domain cannot have port
      domain: `.${req.podName}.${publicConfig?.hostname || "localhost"}`, // Scoped to pod subdomain
    });

    logger.info("Pod auth callback successful", { pod: req.podName });

    // Redirect to final destination
    res.redirect(redirect);
  },
);

/**
 * List streams in pod
 * GET {pod}.webpods.org/.config/api/streams
 */
router.get(
  "/.config/api/streams",
  extractPod,
  async (req: AuthRequest, res: Response) => {
    if (!req.pod || !req.podName) {
      res.status(404).json({
        error: {
          code: "POD_NOT_FOUND",
          message: "Pod not found",
        },
      });
      return;
    }

    const db = getDb();
    const result = await listPodStreams({ db }, req.podName);

    if (!result.success) {
      console.error("listPodStreams failed:", result.error);
      res.status(500).json({
        error: result.error,
      });
      return;
    }

    res.json({
      pod: req.podName,
      streams: result.data,
    });
  },
);

/**
 * Delete entire pod
 * DELETE {pod}.webpods.org/
 */
router.delete(
  "/",
  extractPod,
  authenticate,
  rateLimit("pod_create"),
  async (req: AuthRequest, res: Response) => {
    if (!req.podName || !req.auth) {
      res.status(404).json({
        error: {
          code: "POD_NOT_FOUND",
          message: "Pod not found",
        },
      });
      return;
    }

    const db = getDb();
    const result = await deletePod({ db }, req.podName, req.auth.user_id);

    if (!result.success) {
      const status =
        (result.error as CodedError).code === "FORBIDDEN" ? 403 : 500;
      res.status(status).json({
        error: result.error,
      });
      return;
    }

    res.status(204).send();
  },
);

/**
 * Write to system streams
 * POST {pod}.webpods.org/.config/owner
 * POST {pod}.webpods.org/.config/routing
 * POST {pod}.webpods.org/.config/domains
 */
router.post(
  "/.config/owner",
  extractPod,
  authenticate,
  async (req: AuthRequest, res: Response) => {
    if (!req.podName || !req.auth) {
      res.status(404).json({
        error: {
          code: "POD_NOT_FOUND",
          message: "Pod not found",
        },
      });
      return;
    }

    try {
      const data = ownerSchema.parse(req.body);
      const db = getDb();

      const result = await transferPodOwnership(
        { db },
        req.podName,
        req.auth.user_id,
        data.owner,
      );

      if (!result.success) {
        const status =
          (result.error as CodedError).code === "FORBIDDEN"
            ? 403
            : (result.error as CodedError).code === "USER_NOT_FOUND"
              ? 404
              : 500;
        res.status(status).json({
          error: result.error,
        });
        return;
      }

      res.status(201).json({ success: true });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: {
            code: "INVALID_INPUT",
            message: "Invalid request",
            details: error.errors,
          },
        });
        return;
      }
      res.status(500).json({
        error: {
          code: "INTERNAL_ERROR",
          message: "Internal server error",
        },
      });
    }
  },
);

router.post(
  "/.config/routing",
  extractPod,
  authenticate,
  async (req: AuthRequest, res: Response) => {
    if (!req.podName || !req.auth) {
      res.status(404).json({
        error: {
          code: "POD_NOT_FOUND",
          message: "Pod not found",
        },
      });
      return;
    }

    try {
      const data = linksSchema.parse(req.body);
      const db = getDb();

      // Check ownership
      const ownerResult = await getPodOwner({ db }, req.podName);
      if (!ownerResult.success || ownerResult.data !== req.auth.user_id) {
        res.status(403).json({
          error: {
            code: "FORBIDDEN",
            message: "Only pod owner can update links",
          },
        });
        return;
      }

      const result = await updateLinks(
        { db },
        req.podName,
        data,
        req.auth.user_id,
      );

      if (!result.success) {
        res.status(500).json({
          error: result.error,
        });
        return;
      }

      res.status(201).json({ success: true });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: {
            code: "INVALID_INPUT",
            message: "Invalid request",
            details: error.errors,
          },
        });
        return;
      }
      res.status(500).json({
        error: {
          code: "INTERNAL_ERROR",
          message: "Internal server error",
        },
      });
    }
  },
);

router.post(
  "/.config/domains",
  extractPod,
  authenticate,
  async (req: AuthRequest, res: Response) => {
    if (!req.podName || !req.auth) {
      res.status(404).json({
        error: {
          code: "POD_NOT_FOUND",
          message: "Pod not found",
        },
      });
      return;
    }

    try {
      const data = domainsSchema.parse(req.body);
      const db = getDb();

      // Check ownership
      const ownerResult = await getPodOwner({ db }, req.podName);
      if (!ownerResult.success || ownerResult.data !== req.auth.user_id) {
        res.status(403).json({
          error: {
            code: "FORBIDDEN",
            message: "Only pod owner can update domains",
          },
        });
        return;
      }

      const result = await updateCustomDomains(
        { db },
        req.podName,
        req.auth.user_id,
        data.domains,
      );

      if (!result.success) {
        res.status(500).json({
          error: result.error,
        });
        return;
      }

      res.status(201).json({ success: true });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: {
            code: "INVALID_INPUT",
            message: "Invalid request",
            details: error.errors,
          },
        });
        return;
      }
      res.status(500).json({
        error: {
          code: "INTERNAL_ERROR",
          message: "Internal server error",
        },
      });
    }
  },
);

/**
 * Write to stream with required name
 * POST {pod}.webpods.org/{stream_path}/{name}
 * Example: POST alice.webpods.org/blog/posts/first.md
 */
router.post(
  "/*",
  extractPod,
  authenticate,
  rateLimit("write"),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
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

      // Check if this is a POST with empty body to create a stream
      const isEmptyBody =
        !req.body ||
        (typeof req.body === "object" && Object.keys(req.body).length === 0);

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
        const existingStream = await getStream({ db }, req.podName, streamPath);
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
        const streamLimitResult = await checkRateLimit(
          { db },
          req.auth.user_id,
          "stream_create",
        );

        if (!streamLimitResult.success || !streamLimitResult.data.allowed) {
          res.status(429).json({
            error: {
              code: "RATE_LIMIT_EXCEEDED",
              message: "Too many streams created",
            },
          });
          return;
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

        // Note: stream_create rate limit was already incremented by checkRateLimit above

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
      logger.debug("Stream ID for writing", {
        pathParts,
        streamPath,
        fullPath,
      });
      let content = writeSchema.parse(req.body);
      let contentType = detectContentType(req.headers);
      const accessPermission = req.query.access as string | undefined;

      // Check if content is a data URL first (before checking content type)
      if (typeof content === "string" && content.startsWith("data:")) {
        const parsed = parseDataUrl(content);
        if (!parsed) {
          res.status(400).json({
            error: {
              code: "INVALID_CONTENT",
              message: "Invalid data URL format",
            },
          });
          return;
        }
        // Use the content type from data URL if not explicitly set
        if (!req.headers["x-content-type"]) {
          contentType = parsed.contentType;
        }
        content = parsed.data;
      }

      // Handle binary content (images)
      if (isBinaryContentType(contentType)) {
        // For binary content, expect base64 encoded string
        if (typeof content !== "string") {
          res.status(400).json({
            error: {
              code: "INVALID_CONTENT",
              message:
                "Binary content must be provided as base64 encoded string",
            },
          });
          return;
        }

        // Validate base64
        if (!isValidBase64(content)) {
          res.status(400).json({
            error: {
              code: "INVALID_CONTENT",
              message: "Invalid base64 encoding",
            },
          });
          return;
        }

        // Check size limit (base64 is ~33% larger than binary)
        // Get max payload size from config (e.g., "10mb" -> 10 * 1024 * 1024)
        const config = getConfig();
        const maxSizeStr = config.server.maxPayloadSize || "10mb";
        const maxSizeMatch = maxSizeStr.match(/^(\d+)(mb|kb|gb)?$/i);
        const maxSizeNum = maxSizeMatch ? parseInt(maxSizeMatch[1]!) : 10;
        const unit = maxSizeMatch?.[2]?.toLowerCase() || "mb";
        const multiplier =
          unit === "kb"
            ? 1024
            : unit === "mb"
              ? 1024 * 1024
              : unit === "gb"
                ? 1024 * 1024 * 1024
                : 1024 * 1024;
        const maxBinarySize = maxSizeNum * multiplier;

        const estimatedBinarySize = (content.length * 3) / 4;
        if (estimatedBinarySize > maxBinarySize) {
          res.status(413).json({
            error: {
              code: "CONTENT_TOO_LARGE",
              message: `Content exceeds maximum size of ${maxSizeStr}`,
            },
          });
          return;
        }
      }

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

      // Check if stream exists first
      const existingStream = await getStream({ db }, req.podName, streamPath);

      // If stream doesn't exist, check rate limit before creating
      if (!existingStream.success) {
        const streamLimitResult = await checkRateLimit(
          { db },
          req.auth.user_id,
          "stream_create",
        );

        if (!streamLimitResult.success || !streamLimitResult.data.allowed) {
          res.status(429).json({
            error: {
              code: "RATE_LIMIT_EXCEEDED",
              message: "Too many streams created",
            },
          });
          return;
        }
      }

      // Get the stream (no longer auto-creates)
      const streamResult = await getOrCreateStream(
        { db },
        req.podName,
        streamPath,
        req.auth!.user_id,
        accessPermission,
      );

      if (!streamResult.success) {
        const status =
          (streamResult.error as CodedError).code === "FORBIDDEN"
            ? 403
            : (streamResult.error as CodedError).code === "STREAM_NOT_FOUND"
              ? 404
              : 500;
        res.status(status).json({
          error: streamResult.error,
        });
        return;
      }

      // Note: stream_create rate limit was already incremented by checkRateLimit above

      // Check if this is a .config/* stream - only pod owner can write to these
      if (streamPath.startsWith(".config/")) {
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
          streamResult.data.stream,
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

      // Write record
      const recordResult = await writeRecord(
        { db },
        streamResult.data.stream.id,
        content,
        contentType,
        req.auth.user_id,
        name,
      );

      if (!recordResult.success) {
        // Check for specific error codes
        let status = 500;
        if ((recordResult.error as CodedError).code === "NAME_EXISTS") {
          status = 409;
        } else if ((recordResult.error as CodedError).code === "INVALID_NAME") {
          status = 400;
        }

        res.status(status).json({
          error: recordResult.error,
        });
        return;
      }

      res.status(201).json(recordToResponse(recordResult.data, streamPath));
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: {
            code: "INVALID_INPUT",
            message: "Invalid request",
            details: error.errors,
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
  },
);

/**
 * Root path handler with .config/routing support
 * GET {pod}.webpods.org/
 */
router.get(
  "/",
  extractPod,
  optionalAuth,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    // If no pod_id was extracted, this is the main domain - skip to next handler
    if (!req.podName) {
      return next();
    }

    if (!req.pod) {
      // On subdomains, return POD_NOT_FOUND
      // On main domain (even with rootPod), fall through to generic 404
      const hostname = req.hostname || req.headers.host?.split(":")[0] || "";
      const config = getConfig();
      const mainDomain = config.server.public?.hostname || "localhost";
      const port = config.server.public?.port || config.server.port;

      // Check if this is the main domain (with or without port)
      const isMainDomain =
        hostname === mainDomain ||
        hostname === `${mainDomain}:${port}` ||
        (hostname === "localhost" && mainDomain === "localhost");

      if (isMainDomain) {
        // Main domain - fall through to 404 handler
        return next();
      }

      // Subdomain - pod not found
      res.status(404).json({
        error: {
          code: "POD_NOT_FOUND",
          message: "Pod not found",
        },
      });
      return;
    }

    const db = getDb();

    // Check if path "/" is mapped in .config/routing
    const linkResult = await resolveLink({ db }, req.podName, "/");

    if (linkResult.success && linkResult.data) {
      // Redirect to the mapped stream/record
      const { streamPath, target } = linkResult.data;

      // Rewrite URL and forward to the stream handler
      if (target && target.startsWith("?")) {
        // Handle query parameters (e.g., "?i=-1")
        req.url = `/${streamPath}${target}`;
        req.query = Object.fromEntries(
          new URLSearchParams(target.substring(1)),
        );
      } else if (target) {
        // Handle path targets (e.g., "/record-name")
        req.url = `/${streamPath}${target}`;
      } else {
        // Just stream name
        req.url = `/${streamPath}`;
      }

      // Let Express router handle the rewritten request
      return router(req, res, () => {});
    }

    // No mapping, return 404
    res.status(404).json({
      error: {
        code: "NOT_FOUND",
        message:
          "No content configured for root path. Use .config/routing to configure.",
      },
    });
  },
);

/**
 * Read from stream
 * GET {pod}.webpods.org/{stream_path} - List records or get by query param
 * GET {pod}.webpods.org/{stream_path}?i=0 - Get by index
 * GET {pod}.webpods.org/{stream_path}?i=-1 - Get latest
 * GET {pod}.webpods.org/{stream_path}?i=10:20 - Get range
 * GET {pod}.webpods.org/{stream_path}/{name} - Get by name
 */
router.get(
  "/*",
  extractPod,
  optionalAuth,
  rateLimit("read"),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    // If no pod_id was extracted, this is the main domain - skip to next handler
    if (!req.podName) {
      return next();
    }

    if (!req.pod) {
      // On subdomains, return POD_NOT_FOUND
      // On main domain (even with rootPod), fall through to generic 404
      const hostname = req.hostname || req.headers.host?.split(":")[0] || "";
      const config = getConfig();
      const mainDomain = config.server.public?.hostname || "localhost";
      const port = config.server.public?.port || config.server.port;

      // Check if this is the main domain (with or without port)
      const isMainDomain =
        hostname === mainDomain ||
        hostname === `${mainDomain}:${port}` ||
        (hostname === "localhost" && mainDomain === "localhost");

      if (isMainDomain) {
        // Main domain - fall through to 404 handler
        return next();
      }

      // Subdomain - pod not found
      res.status(404).json({
        error: {
          code: "POD_NOT_FOUND",
          message: "Pod not found",
        },
      });
      return;
    }

    const pathParts = req.path.substring(1).split("/"); // Remove leading /
    const db = getDb();

    // First check if this path is mapped in .config/routing
    const linkResult = await resolveLink({ db }, req.podName, req.path);

    if (linkResult.success && linkResult.data) {
      // Redirect to the mapped stream/record
      const { streamPath, target } = linkResult.data;

      // Rewrite URL and forward to the stream handler
      if (target && target.startsWith("?")) {
        // Handle query parameters (e.g., "?i=-1")
        req.url = `/${streamPath}${target}`;
        req.query = Object.fromEntries(
          new URLSearchParams(target.substring(1)),
        );
      } else if (target) {
        // Handle path targets (e.g., "/record-name")
        req.url = `/${streamPath}${target}`;
      } else {
        // Just stream name
        req.url = `/${streamPath}`;
      }

      // Let Express router handle the rewritten request
      return router(req, res, () => {});
    }

    // Check for index query parameter
    const indexQuery = req.query.i as string | undefined;

    // Determine if last part is a name or part of stream path
    let streamPath: string;
    let name: string | undefined;

    if (indexQuery) {
      // If using index query, entire path is stream path
      streamPath = pathParts.join("/");
    } else if (pathParts.length > 1) {
      // Check if last part could be a name (not using index query)
      // Try to find stream with full path first
      const fullPath = pathParts.join("/");
      const streamResult = await getStream({ db }, req.podName, fullPath);

      if (streamResult.success && streamResult.data) {
        streamPath = fullPath;
      } else {
        // Assume last part is name
        name = pathParts.pop();
        streamPath = pathParts.join("/");
      }
    } else {
      streamPath = pathParts[0]!;
    }

    // Get stream
    const streamResult = await getStream({ db }, req.podName, streamPath);

    // Special handling for recursive queries - they can work even if exact stream doesn't exist
    const recursive = req.query.recursive === "true";

    if (!streamResult.success || !streamResult.data) {
      // If this is a recursive query and we're not looking for a specific record,
      // we can still search for nested streams
      if (recursive && !name && !indexQuery) {
        // Try to find nested streams even if the exact stream doesn't exist
        const config = getConfig();
        const maxLimit = config.rateLimits.maxRecordLimit;

        let limit = parseInt(req.query.limit as string) || 100;
        if (limit > maxLimit) {
          limit = maxLimit;
        }

        const after = req.query.after
          ? parseInt(req.query.after as string)
          : undefined;
        const unique = req.query.unique === "true";

        if (unique) {
          res.status(400).json({
            error: {
              code: "INVALID_PARAMETERS",
              message:
                "Cannot use 'unique' and 'recursive' parameters together",
            },
          });
          return;
        }

        const result = await listRecordsRecursive(
          { db },
          req.podName,
          streamPath,
          req.auth?.user_id || null,
          limit,
          after,
        );

        if (!result.success) {
          res.status(500).json({
            error: result.error,
          });
          return;
        }

        const data = result.data;
        res.json({
          records: data.records.map((r) => recordToResponse(r, streamPath)),
          total: data.total,
          hasMore: data.hasMore,
          nextIndex:
            data.hasMore && data.records.length > 0
              ? data.records[data.records.length - 1]?.index
              : null,
        });
        return;
      }

      // Regular non-recursive case - stream not found
      const fullPath = req.path.substring(1);
      if (name) {
        // We were looking for a record in a stream that doesn't exist
        res.status(404).json({
          error: {
            code: "NOT_FOUND",
            message: `Not found: no stream '${fullPath}' and no stream '${streamPath}' with record '${name}'`,
          },
        });
      } else {
        // We were looking for a stream
        res.status(404).json({
          error: {
            code: "STREAM_NOT_FOUND",
            message: `Stream '${streamPath}' not found`,
          },
        });
      }
      return;
    }

    // Check read permission
    const canReadResult = await canRead(
      { db },
      streamResult.data,
      req.auth?.user_id || null,
    );
    if (!canReadResult) {
      res.status(403).json({
        error: {
          code: "FORBIDDEN",
          message: "No read permission for this stream",
        },
      });
      return;
    }

    // Handle index query parameter
    if (indexQuery) {
      const parsed = parseIndexQuery(indexQuery);
      if (!parsed) {
        res.status(400).json({
          error: {
            code: "INVALID_INDEX",
            message: "Invalid index format. Use ?i=0, ?i=-1, or ?i=10:20",
          },
        });
        return;
      }

      if (parsed.type === "single") {
        // Single record by index (don't prefer name when using ?i=)
        const result = await getRecord(
          { db },
          req.podName,
          streamResult.data.id,
          parsed.start.toString(),
          false,
        );

        if (!result.success) {
          res.status(404).json({
            error: result.error,
          });
          return;
        }

        // Check if record is deleted
        const record = result.data;
        try {
          const content =
            typeof record.content === "string" &&
            record.contentType === "application/json"
              ? JSON.parse(record.content)
              : record.content;

          if (
            typeof content === "object" &&
            content !== null &&
            content.deleted === true
          ) {
            res.status(404).json({
              error: {
                code: "RECORD_DELETED",
                message: "Record has been deleted",
              },
            });
            return;
          }
        } catch {
          // Not JSON or can't parse, continue normally
        }

        // Return raw content for single records
        // Set headers
        res.setHeader("X-Content-Hash", record.contentHash);
        res.setHeader("X-Hash", record.hash);
        res.setHeader("X-Previous-Hash", record.previousHash || "");
        res.setHeader("X-Author", record.userId);
        res.setHeader("X-Timestamp", record.createdAt.toISOString());

        // Set content type and send response
        res.type(record.contentType);

        // Handle different content types
        if (isBinaryContentType(record.contentType)) {
          // Decode base64 for binary content
          const contentStr =
            typeof record.content === "string"
              ? record.content
              : String(record.content);
          const buffer = Buffer.from(contentStr, "base64");
          res.send(buffer);
        } else if (
          record.contentType === "application/json" &&
          typeof record.content === "string"
        ) {
          // Parse JSON content if needed
          try {
            res.send(JSON.parse(record.content));
          } catch {
            res.send(record.content);
          }
        } else {
          res.send(record.content);
        }
      } else {
        // Range of records
        const result = await getRecordRange(
          { db },
          req.podName,
          streamResult.data.id,
          parsed.start,
          parsed.end!,
        );

        if (!result.success) {
          res.status(500).json({
            error: result.error,
          });
          return;
        }

        res.json({
          records: result.data.map((r) => recordToResponse(r, streamPath)),
          range: { start: parsed.start, end: parsed.end },
          total: result.data.length,
        });
      }
    } else if (name) {
      // Get by name (prefer name over index for path-based access)
      const result = await getRecord(
        { db },
        req.podName,
        streamResult.data.id,
        name,
        true,
      );

      if (!result.success) {
        res.status(404).json({
          error: result.error,
        });
        return;
      }

      // Check if there's a tombstone record for this name that's newer than the current record
      const tombstonePattern = `${name}.deleted.%`;
      const tombstones = await db.manyOrNone(
        `SELECT * FROM record
         WHERE stream_id = $(streamId)
           AND name LIKE $(pattern)
           AND index > $(index)
         ORDER BY index DESC
         LIMIT 1`,
        {
          streamId: streamResult.data.id,
          pattern: tombstonePattern,
          index: result.data.index,
        },
      );

      if (tombstones.length > 0) {
        // Found a newer tombstone, so this record is considered deleted
        res.status(404).json({
          error: {
            code: "RECORD_DELETED",
            message: "Record has been deleted",
          },
        });
        return;
      }

      // Check if record itself is a purged record
      const record = result.data;
      try {
        const content =
          typeof record.content === "string" &&
          record.contentType === "application/json"
            ? JSON.parse(record.content)
            : record.content;

        if (
          typeof content === "object" &&
          content !== null &&
          (content.deleted === true || content.purged === true)
        ) {
          res.status(404).json({
            error: {
              code: "RECORD_DELETED",
              message: "Record has been deleted",
            },
          });
          return;
        }
      } catch {
        // Not JSON or can't parse, continue normally
      }

      // Return raw content for single records
      // Set headers
      res.setHeader("X-Content-Hash", record.contentHash);
      res.setHeader("X-Hash", record.hash);
      res.setHeader("X-Previous-Hash", record.previousHash || "");
      res.setHeader("X-Author", record.userId);
      res.setHeader("X-Timestamp", record.createdAt.toISOString());

      // Set content type and send response
      res.type(record.contentType);

      // Handle different content types
      if (isBinaryContentType(record.contentType)) {
        // Decode base64 for binary content
        const contentStr =
          typeof record.content === "string"
            ? record.content
            : String(record.content);
        const buffer = Buffer.from(contentStr, "base64");
        res.send(buffer);
      } else if (
        record.contentType === "application/json" &&
        typeof record.content === "string"
      ) {
        // Parse JSON content if needed
        try {
          res.send(JSON.parse(record.content));
        } catch {
          res.send(record.content);
        }
      } else {
        res.send(record.content);
      }
    } else {
      // List all records
      const config = getConfig();
      const maxLimit = config.rateLimits.maxRecordLimit;

      // Parse and cap the limit to maxRecordLimit
      let limit = parseInt(req.query.limit as string) || 100;
      if (limit > maxLimit) {
        limit = maxLimit; // Silently cap to max without erroring
      }

      const after = req.query.after
        ? parseInt(req.query.after as string)
        : undefined;
      const unique = req.query.unique === "true";
      // recursive was already defined earlier

      // Use appropriate listing function based on parameters
      let result;
      if (recursive) {
        // Recursive listing doesn't support unique mode yet
        if (unique) {
          res.status(400).json({
            error: {
              code: "INVALID_PARAMETERS",
              message:
                "Cannot use 'unique' and 'recursive' parameters together",
            },
          });
          return;
        }
        result = await listRecordsRecursive(
          { db },
          req.podName,
          streamPath,
          req.auth?.user_id || null,
          limit,
          after,
        );
      } else if (unique) {
        result = await listUniqueRecords(
          { db },
          req.podName,
          streamResult.data.id,
          limit,
          after,
        );
      } else {
        result = await listRecords(
          { db },
          req.podName,
          streamResult.data.id,
          limit,
          after,
        );
      }

      if (!result.success) {
        res.status(500).json({
          error: result.error,
        });
        return;
      }

      // All listing functions now return the same format
      const data = result.data as {
        records: StreamRecord[];
        total: number;
        hasMore: boolean;
      };
      res.json({
        records: data.records.map((r) => recordToResponse(r, streamPath)),
        total: data.total,
        hasMore: data.hasMore,
        nextIndex:
          data.hasMore && data.records.length > 0
            ? data.records[data.records.length - 1]?.index
            : null,
      });
    }
  },
);

/**
 * Delete stream or record
 * DELETE {pod}.webpods.org/{stream_path} - Delete stream
 * DELETE {pod}.webpods.org/{stream_path}/{name} - Delete record (soft delete)
 * DELETE {pod}.webpods.org/{stream_path}/{name}?purge=true - Purge record (hard delete)
 */
router.delete(
  "/*",
  extractPod,
  authenticate,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
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
  },
);

export default router;
