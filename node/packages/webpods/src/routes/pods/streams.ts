/**
 * Stream management API routes
 */

import { Response, AuthRequest, extractPod } from "./shared.js";
import { rateLimit } from "../../middleware/ratelimit.js";
import { getDb } from "../../db/index.js";
import { listPodStreams } from "../../domain/pods/list-pod-streams.js";

/**
 * List streams in pod
 * GET {pod}.webpods.org/.config/api/streams
 *
 * Query params:
 * - path: Optional stream path to query
 * - recursive: Include child streams (default: true if no path, false if path given)
 * - includeRecordCounts: Include record statistics (default: false)
 * - includeHashes: Include hash chain information (default: false)
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

  // Parse query parameters
  const streamPath = req.query.path as string | undefined;
  const recursiveParam = req.query.recursive as string | undefined;
  const includeRecordCounts = req.query.includeRecordCounts === "true";
  const includeHashes = req.query.includeHashes === "true";

  // Determine recursive behavior
  const recursive =
    recursiveParam !== undefined ? recursiveParam === "true" : !streamPath; // Default: true if no path, false if path given

  const db = getDb();
  const result = await listPodStreams({ db }, req.podName, {
    path: streamPath,
    recursive,
    includeRecordCounts,
    includeHashes,
  });

  if (!result.success) {
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
  middleware: [extractPod, rateLimit("read")] as const,
  handler: listStreamsHandler,
};
