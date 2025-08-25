/**
 * Resolve a path using .meta/links stream
 */

import { DataContext } from "../data-context.js";
import { Result, success } from "../../utils/result.js";
import { StreamDbRow, RecordDbRow } from "../../db-types.js";
import { createLogger } from "../../logger.js";

const logger = createLogger("webpods:domain:routing");

interface LinkMapping {
  [path: string]: string;
}

export async function resolveLink(
  ctx: DataContext,
  podId: string,
  path: string,
): Promise<Result<string | null>> {
  try {
    // Get the .meta/links stream
    const linksStream = await ctx.db.oneOrNone<StreamDbRow>(
      `SELECT * FROM stream
       WHERE pod_id = $(podId)
         AND stream_id = '.meta/links'`,
      { podId },
    );

    if (!linksStream) {
      return success(null);
    }

    // Get all link records
    const records = await ctx.db.manyOrNone<RecordDbRow>(
      `SELECT * FROM record
       WHERE stream_id = $(streamId)
       ORDER BY index ASC`,
      { streamId: linksStream.id },
    );

    // Build the current link mapping
    const links: LinkMapping = {};
    for (const record of records) {
      try {
        const content = JSON.parse(record.content);
        if (content.path && content.target) {
          if (content.action === "delete") {
            delete links[content.path];
          } else {
            links[content.path] = content.target;
          }
        }
      } catch {
        // Skip invalid JSON
      }
    }

    // Exact match
    if (links[path]) {
      return success(links[path]);
    }

    // Check for wildcard patterns (e.g., /blog/* -> /posts)
    for (const [pattern, target] of Object.entries(links)) {
      if (pattern.endsWith("/*")) {
        const basePath = pattern.slice(0, -2);
        if (path.startsWith(basePath)) {
          // Replace the matched part with the target
          const remainingPath = path.slice(basePath.length);
          return success(target + remainingPath);
        }
      }
    }

    return success(null);
  } catch (error) {
    logger.error("Failed to resolve link", { error, podId, path });
    return success(null);
  }
}