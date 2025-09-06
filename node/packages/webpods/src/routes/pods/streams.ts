/**
 * Stream management API routes
 */

import { Response, AuthRequest, extractPod } from "./shared.js";
import { getDb } from "../../db/index.js";
import { listPodStreams } from "../../domain/pods/list-pod-streams.js";

/**
 * List streams in pod
 * GET {pod}.webpods.org/.config/api/streams
 */
export const listStreamsHandler = async (req: AuthRequest, res: Response) => {
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
};

export const listStreamsRoute = {
  path: "/.config/api/streams",
  middleware: [extractPod] as const,
  handler: listStreamsHandler,
};
