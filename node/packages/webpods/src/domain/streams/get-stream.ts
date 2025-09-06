/**
 * Get a stream - this now delegates to getStreamByPath
 */

import { DataContext } from "../data-context.js";
import { Result } from "../../utils/result.js";
import { Stream } from "../../types.js";
import { getStreamByPath } from "./get-stream-by-path.js";

/**
 * Get a stream by pod name and stream path
 * This is now a thin wrapper around getStreamByPath for compatibility
 */
export async function getStream(
  ctx: DataContext,
  podName: string,
  streamPath: string,
): Promise<Result<Stream>> {
  return getStreamByPath(ctx, podName, streamPath);
}
