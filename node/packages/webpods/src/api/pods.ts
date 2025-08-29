/**
 * Pod listing API endpoint
 */

import { Router, Response } from "express";
import type { AuthRequest } from "../types.js";
import { authenticateHybrid } from "../middleware/hybrid-auth.js";
import { rateLimit } from "../middleware/ratelimit.js";
import { getDb } from "../db/index.js";
import { createLogger } from "../logger.js";
import { listUserPods } from "../domain/pods/list-user-pods.js";
import { createPod } from "../domain/pods/create-pod.js";
import { z } from "zod";

const logger = createLogger("webpods:api:pods");
const router = Router();

// Schema for pod creation
const createPodSchema = z.object({
  name: z
    .string()
    .min(2)
    .max(63)
    .regex(
      /^[a-z0-9-]+$/,
      "Pod name must contain only lowercase letters, numbers, and hyphens",
    ),
});

/**
 * List all pods owned by the authenticated user
 * GET /api/pods
 */
router.get("/", authenticateHybrid, async (req: AuthRequest, res: Response) => {
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
  const result = await listUserPods({ db }, req.auth.user_id);

  if (!result.success) {
    logger.error("Failed to list pods", {
      userId: req.auth.user_id,
      error: result.error,
    });
    res.status(500).json({
      error: {
        code: "INTERNAL_ERROR",
        message: "Failed to list pods",
      },
    });
    return;
  }

  // Map to expected API format
  const apiPods = result.data.map((pod) => ({
    name: pod.name,
    id: pod.name, // Use name as ID for backwards compatibility
    created_at: pod.created_at,
    metadata: pod.metadata,
  }));

  logger.info("Listed pods for user", {
    userId: req.auth.user_id,
    count: apiPods.length,
  });

  res.json(apiPods);
});

/**
 * Create a new pod
 * POST /api/pods
 */
router.post(
  "/",
  authenticateHybrid,
  rateLimit("pod_create"),
  async (req: AuthRequest, res: Response) => {
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
      const data = createPodSchema.parse(req.body);
      const db = getDb();

      // Create the pod with ownership
      const result = await createPod({ db }, data.name, req.auth.user_id);

      if (!result.success) {
        const errorCode = (result.error as { code?: string }).code;
        const status = errorCode === "POD_EXISTS" ? 409 : 500;
        res.status(status).json({
          error: result.error,
        });
        return;
      }

      logger.info("Pod created successfully", {
        podName: data.name,
        userId: req.auth.user_id,
      });

      res.status(201).json({
        name: result.data.name,
        id: result.data.name,
        created_at: result.data.createdAt,
        message: `Pod '${data.name}' created successfully`,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: {
            code: "INVALID_INPUT",
            message: error.errors[0]?.message || "Invalid input",
          },
        });
        return;
      }

      logger.error("Failed to create pod", { error });
      res.status(500).json({
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to create pod",
        },
      });
    }
  },
);

export default router;
