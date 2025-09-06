/**
 * Resolve a path using .config/routing configuration
 */

import { DataContext } from "../data-context.js";
import { Result, success } from "../../utils/result.js";
import { RecordDbRow, StreamDbRow } from "../../db-types.js";
import { createLogger } from "../../logger.js";

const logger = createLogger("webpods:domain:routing");

interface LinkMapping {
  streamPath: string;
  target: string;
}

export async function resolveLink(
  ctx: DataContext,
  podName: string,
  path: string,
): Promise<Result<LinkMapping | null>> {
  try {
    // Get .config stream
    const configStream = await ctx.db.oneOrNone<StreamDbRow>(
      `SELECT id FROM stream 
       WHERE pod_name = $(pod_name) 
         AND name = '.config' 
         AND parent_id IS NULL`,
      { pod_name: podName },
    );

    if (!configStream) {
      return success(null);
    }

    // Get routing stream (child of .config)
    const routingStream = await ctx.db.oneOrNone<StreamDbRow>(
      `SELECT id FROM stream 
       WHERE parent_id = $(parent_id) 
         AND name = 'routing'`,
      { parent_id: configStream.id },
    );

    if (!routingStream) {
      return success(null);
    }

    // Get the latest routing record
    const record = await ctx.db.oneOrNone<RecordDbRow>(
      `SELECT * FROM record 
       WHERE stream_id = $(stream_id)
       ORDER BY created_at DESC
       LIMIT 1`,
      { stream_id: routingStream.id },
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
      const [streamPath, query] = mapping.split("?");
      return success({
        streamPath: streamPath!,
        target: query ? `?${query}` : "",
      });
    }

    // Handle format like "homepage/-1" or "homepage/my-post"
    const parts = mapping.split("/");

    if (parts.length === 1) {
      // Just stream name, no target
      return success({
        streamPath: parts[0]!,
        target: "",
      });
    }

    // Stream name with record name/index
    const streamPath = parts[0]!;
    const recordTarget = parts.slice(1).join("/");
    return success({
      streamPath,
      target: `/${recordTarget}`,
    });
  } catch (error: unknown) {
    logger.error("Failed to resolve link", { error, podName, path });
    return success(null);
  }
}
