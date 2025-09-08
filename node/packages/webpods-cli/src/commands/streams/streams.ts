/**
 * Stream management commands
 */

import { podRequest } from "../../http/index.js";
import { createLogger, createCliOutput } from "../../logger.js";

const logger = createLogger("webpods:cli:streams");

/**
 * List all streams in a pod
 */
export async function streams(options: {
  quiet?: boolean;
  pod?: string;
  token?: string;
  server?: string;
  profile?: string;
  format?: string;
  [key: string]: unknown;
}): Promise<void> {
  const output = createCliOutput(options.quiet);

  try {
    logger.debug("Listing streams", { pod: options.pod });

    if (!options.pod) {
      output.error("Pod name is required for listing streams.");
      process.exit(1);
    }

    const result = await podRequest<{
      streams: Array<{ name: string; [key: string]: unknown }>;
    }>(options.pod, "/.config/api/streams", {
      token: options.token,
      server: options.server,
    });

    if (!result.success) {
      output.error("Error: " + result.error.message);
      logger.error("Stream listing failed", {
        pod: options.pod,
        error: result.error,
      });
      process.exit(1);
    }

    const streamList = result.data.streams || [];
    // Extract stream names from Stream objects, removing leading slash
    const streamNames = streamList.map((s) =>
      typeof s === "string" ? s : s.name.replace(/^\//, ""),
    );
    logger.debug("Retrieved streams", { count: streamNames.length });

    if (streamNames.length === 0) {
      output.print(`No streams found in pod '${options.pod}'.`);
      return;
    }

    const format = options.format || "table";
    logger.debug("Displaying streams", { format });

    switch (format) {
      case "json":
        output.print(JSON.stringify(streamNames, null, 2));
        break;
      case "yaml":
        streamNames.forEach((stream) => {
          output.print(`- ${stream}`);
        });
        break;
      case "csv":
        output.print("stream");
        streamNames.forEach((stream) => {
          output.print(`"${stream}"`);
        });
        break;
      default: // table
        output.print(`Streams in pod '${options.pod}':`);
        output.print("─".repeat(30));
        streamNames.forEach((stream) => {
          output.print(`${stream}`);
        });
        output.print("─".repeat(30));
        output.print(
          `Total: ${streamNames.length} stream${streamNames.length === 1 ? "" : "s"}`,
        );
    }

    logger.info("Streams listed successfully", {
      pod: options.pod,
      count: streamNames.length,
      format,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Streams command failed", {
      pod: options.pod,
      error: errorMessage,
    });
    output.error("Error: " + errorMessage);
    process.exit(1);
  }
}

/**
 * Delete an entire stream
 */
export async function deleteStream(options: {
  quiet?: boolean;
  pod?: string;
  stream?: string;
  force?: boolean;
  token?: string;
  server?: string;
  profile?: string;
  [key: string]: unknown;
}): Promise<void> {
  const output = createCliOutput(options.quiet);

  try {
    logger.debug("Deleting stream", {
      pod: options.pod,
      stream: options.stream,
      force: options.force,
    });

    if (!options.pod || !options.stream) {
      output.error("Pod and stream name are required for deleting streams.");
      process.exit(1);
    }

    if (!options.force) {
      output.print(
        `WARNING: This will permanently delete stream '/${options.stream}' and ALL its records.`,
      );
      output.print("This action cannot be undone!");
      output.print("Use --force to skip this confirmation.");
      logger.info("Stream deletion cancelled - confirmation required", {
        pod: options.pod,
        stream: options.stream,
      });
      process.exit(0);
    }

    const result = await podRequest<void>(options.pod, `/${options.stream}`, {
      method: "DELETE",
      token: options.token,
      server: options.server,
    });

    if (!result.success) {
      if (result.error.code === "NOT_FOUND") {
        output.error(
          `Stream '/${options.stream}' not found in pod '${options.pod}'.`,
        );
        logger.warn("Stream not found for deletion", {
          pod: options.pod,
          stream: options.stream,
        });
      } else {
        output.error("Error: " + result.error.message);
        logger.error("Stream deletion failed", {
          pod: options.pod,
          stream: options.stream,
          error: result.error,
        });
      }
      process.exit(1);
    }

    output.success(`Stream '/${options.stream}' deleted successfully.`);
    logger.info("Stream deleted successfully", {
      pod: options.pod,
      stream: options.stream,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Delete stream command failed", {
      pod: options.pod,
      stream: options.stream,
      error: errorMessage,
    });
    output.error("Error: " + errorMessage);
    process.exit(1);
  }
}
