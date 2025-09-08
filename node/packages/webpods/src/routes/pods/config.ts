/**
 * Pod configuration routes (ownership, routing, domains)
 */

import { z } from "zod";
import {
  Response,
  AuthRequest,
  extractPod,
  authenticate,
  ownerSchema,
  linksSchema,
  domainsSchema,
  CodedError,
} from "./shared.js";
import { getDb } from "../../db/index.js";
import { transferPodOwnership } from "../../domain/pods/transfer-pod-ownership.js";
import { getPodOwner } from "../../domain/pods/get-pod-owner.js";
import { updateLinks } from "../../domain/routing/update-links.js";
import { updateCustomDomains } from "../../domain/routing/update-custom-domains.js";

/**
 * Transfer pod ownership
 * POST {pod}.webpods.org/.config/owner
 */
export const transferOwnerHandler = async (req: AuthRequest, res: Response) => {
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
      data.userId,
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
};

/**
 * Update pod routing/links
 * POST {pod}.webpods.org/.config/routing
 */
export const updateRoutingHandler = async (req: AuthRequest, res: Response) => {
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
          message: "Only pod owner can update routing",
        },
      });
      return;
    }

    const result = await updateLinks(
      { db },
      req.podName,
      data as Record<string, string>,
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
};

/**
 * Update custom domains
 * POST {pod}.webpods.org/.config/domains
 */
export const updateDomainsHandler = async (req: AuthRequest, res: Response) => {
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
};

// Export route configurations
export const transferOwnerRoute = {
  path: "/.config/owner",
  middleware: [extractPod, authenticate] as const,
  handler: transferOwnerHandler,
};

export const updateRoutingRoute = {
  path: "/.config/routing",
  middleware: [extractPod, authenticate] as const,
  handler: updateRoutingHandler,
};

export const updateDomainsRoute = {
  path: "/.config/domains",
  middleware: [extractPod, authenticate] as const,
  handler: updateDomainsHandler,
};
