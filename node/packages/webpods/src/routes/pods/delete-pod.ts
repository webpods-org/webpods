/**
 * Pod deletion route handler
 */

import {
  Response,
  AuthRequest,
  extractPod,
  authenticate,
  rateLimit,
  CodedError,
} from "./shared.js";
import { getDb } from "../../db/index.js";
import { deletePod } from "../../domain/pods/delete-pod.js";

/**
 * Delete entire pod
 * DELETE {pod}.webpods.org/
 */
export const deletePodHandler = async (req: AuthRequest, res: Response) => {
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
};

export const deletePodRoute = {
  path: "/",
  middleware: [extractPod, authenticate, rateLimit("pod_create")] as const,
  handler: deletePodHandler,
};
