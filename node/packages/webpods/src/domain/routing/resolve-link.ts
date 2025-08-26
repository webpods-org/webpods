/**
 * Resolve a path using .meta/links configuration
 */

import { DataContext } from "../data-context.js";
import { Result, success } from "../../utils/result.js";
import { RecordDbRow } from "../../db-types.js";
import { createLogger } from "../../logger.js";

const logger = createLogger("webpods:domain:routing");

interface LinkMapping {
  streamId: string;
  target: string;
}

export async function resolveLink(
  ctx: DataContext,
  podName: string,
  path: string,
): Promise<Result<LinkMapping | null>> {
  try {
    // Get the latest .meta/links record
    const record = await ctx.db.oneOrNone<RecordDbRow>(
      `SELECT r.*
       FROM record r
       WHERE r.stream_pod_name = $(pod_name)
         AND r.stream_id = '.meta/links'
       ORDER BY r.created_at DESC
       LIMIT 1`,
      { pod_name: podName },
    );

    if (!record) {
      return success(null);
    }

    const links =
      typeof record.content === "string"
        ? JSON.parse(record.content)
        : record.content;

    if (!links[path]) {
      return success(null);
    }

    // Parse the mapping (e.g., "homepage/-1", "blog/my-post", or "homepage?i=-1")
    const mapping = links[path];

    // Check if it has query parameters
    if (mapping.includes("?")) {
      // Handle format like "homepage?i=-1"
      const [streamId, query] = mapping.split("?");
      return success({
        streamId: streamId!,
        target: query ? `?${query}` : "",
      });
    }

    // Handle format like "homepage/-1" or "homepage/my-post"
    const parts = mapping.split("/");

    if (parts.length === 1) {
      // Just stream name, no target
      return success({
        streamId: parts[0]!,
        target: "",
      });
    }

    // Stream name with record name/index
    const streamId = parts[0]!;
    const recordTarget = parts.slice(1).join("/");
    return success({
      streamId,
      target: `/${recordTarget}`,
    });
  } catch (error: any) {
    logger.error("Failed to resolve link", { error, podName, path });
    return success(null);
  }
}
