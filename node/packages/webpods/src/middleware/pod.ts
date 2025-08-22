/**
 * Pod extraction middleware
 */

import { Request, Response, NextFunction } from "express";
import { extractPodName, isMainDomain } from "../utils.js";
import { findPodByDomain } from "../domain/routing.js";
import { getPod } from "../domain/pods.js";
import { getDb } from "../db.js";
import { createLogger } from "../logger.js";
import { Pod } from "../types.js";
import { getConfig } from "../config-loader.js";

const logger = createLogger("webpods:pod");

// Extend Express Request type
declare module "express-serve-static-core" {
  interface Request {
    pod?: Pod;
    pod_name?: string;
  }
}

/**
 * Extract pod from hostname
 */
export async function extractPod(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // If pod_name is already set (e.g., by rootPod handler), skip extraction
    if (req.pod_name) {
      next();
      return;
    }

    const hostname = req.hostname || req.headers.host?.split(":")[0] || "";
    const db = getDb();

    // Get config to determine main domain
    const config = getConfig();
    const mainDomain = config.server.public?.hostname || "localhost";

    // First try standard subdomain format
    let podName = extractPodName(hostname, mainDomain);

    // If not found, check custom domains
    if (!podName) {
      const result = await findPodByDomain(db, hostname);
      if (result.success && result.data) {
        podName = result.data;
      }
    }

    // If still no pod found and this is the main domain, check for rootPod config
    if (!podName && isMainDomain(hostname, mainDomain) && config.rootPod) {
      podName = config.rootPod;
    }

    if (!podName) {
      // No pod found - just continue without setting pod
      next();
      return;
    }

    // Store the pod_name even if pod doesn't exist yet
    req.pod_name = podName;

    // Try to get the pod (may not exist yet)
    const podResult = await getPod(db, podName);

    if (podResult.success) {
      req.pod = podResult.data;
    }
    // If pod doesn't exist, it will be created on first write

    logger.debug("Pod extracted", { podName, hostname });
    next();
  } catch (error) {
    logger.error("Pod extraction error", { error });
    res.status(500).json({
      error: {
        code: "INTERNAL_ERROR",
        message: "Failed to extract pod",
      },
    });
  }
}

/**
 * Optional pod extraction - doesn't fail if no pod found
 */
export async function optionalExtractPod(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const hostname = req.hostname || req.headers.host?.split(":")[0] || "";
    const db = getDb();

    // Get config to determine main domain
    const config = getConfig();
    const mainDomain = config.server.public?.hostname || "localhost";

    // First try standard subdomain format
    let podName = extractPodName(hostname, mainDomain);

    // If not found, check custom domains
    if (!podName) {
      const result = await findPodByDomain(db, hostname);
      if (result.success && result.data) {
        podName = result.data;
      }
    }

    if (podName) {
      // Get the pod
      const podResult = await getPod(db, podName);

      if (podResult.success) {
        req.pod = podResult.data;
        req.pod_name = podName;
      }
    }

    next();
  } catch (error) {
    logger.error("Optional pod extraction error", { error });
    next();
  }
}
