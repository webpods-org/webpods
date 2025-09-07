/**
 * Pod extraction middleware
 */

import { Request, Response, NextFunction } from "express";
import { extractPodName, isMainDomain } from "../utils.js";
import { findPodByDomain } from "../domain/routing/find-pod-by-domain.js";
import { getPod } from "../domain/pods/get-pod.js";
import { getDb } from "../db/index.js";
import { createLogger } from "../logger.js";
import { Pod } from "../types.js";
import { getConfig } from "../config-loader.js";

const logger = createLogger("webpods:pod");

// Extend Express Request type
declare module "express-serve-static-core" {
  interface Request {
    pod?: Pod;
    podName?: string;
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
    if (req.podName) {
      next();
      return;
    }

    const hostname = req.hostname || req.headers.host?.split(":")[0] || "";
    const db = getDb();

    // Get config to determine main domain
    const config = getConfig();
    const mainDomain = config.server.public?.hostname || "localhost";

    // For localhost testing, check X-Pod-Name header first
    let podName: string | undefined;
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      const headerPodName = req.headers["x-pod-name"];
      if (headerPodName && typeof headerPodName === "string") {
        podName = headerPodName;
      }
    }

    // If no header, try standard subdomain format
    if (!podName) {
      podName = extractPodName(hostname, mainDomain) || undefined;
    }

    // If not found, check custom domains
    if (!podName) {
      const result = await findPodByDomain({ db }, hostname);
      if (result.success && result.data) {
        podName = result.data.name;
      }
    }

    // If still no pod found and this is the main domain, check for rootPod config
    if (!podName && isMainDomain(hostname, mainDomain) && config.rootPod) {
      logger.debug("Setting rootPod for main domain", {
        rootPod: config.rootPod,
        hostname,
        mainDomain,
        isMain: isMainDomain(hostname, mainDomain),
      });
      podName = config.rootPod;
    }

    if (!podName) {
      // No pod found - just continue without setting pod
      next();
      return;
    }

    // Store the pod_name for reference
    req.podName = podName;

    // Try to get the pod
    const podResult = await getPod({ db }, podName);

    if (podResult.success) {
      req.pod = podResult.data;
    }
    // If pod doesn't exist, operations will fail with POD_NOT_FOUND

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

    // For localhost testing, check X-Pod-Name header first
    let podName: string | undefined;
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      const headerPodName = req.headers["x-pod-name"];
      if (headerPodName && typeof headerPodName === "string") {
        podName = headerPodName;
      }
    }

    // If no header, try standard subdomain format
    if (!podName) {
      podName = extractPodName(hostname, mainDomain) || undefined;
    }

    // If not found, check custom domains
    if (!podName) {
      const result = await findPodByDomain({ db }, hostname);
      if (result.success && result.data) {
        podName = result.data.name;
      }
    }

    if (podName) {
      // Get the pod
      const podResult = await getPod({ db }, podName);

      if (podResult.success) {
        req.pod = podResult.data;
        req.podName = podName;
      }
    }

    next();
  } catch (error) {
    logger.error("Optional pod extraction error", { error });
    next();
  }
}
