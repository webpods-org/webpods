/**
 * Stream management commands
 */

import { podRequest } from "../../http/index.js";
import { GlobalOptions } from "../../types.js";
import { createLogger, createCliOutput } from "../../logger.js";

const logger = createLogger("webpods:cli:streams");

interface StreamsOptions extends GlobalOptions {
  pod: string;
}

interface DeleteStreamOptions extends GlobalOptions {
  pod: string;
  stream: string;
  force?: boolean;
}

/**
 * List all streams in a pod
 */
export async function streams(options: StreamsOptions): Promise<void> {
  const output = createCliOutput(options.quiet);

  try {
    logger.debug("Listing streams", { pod: options.pod });

    const result = await podRequest<{ streams: string[] }>(options.pod, "/", {
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
    logger.debug("Retrieved streams", { count: streamList.length });

    if (streamList.length === 0) {
      output.print(`No streams found in pod '${options.pod}'.`);
      return;
    }

    const format = options.format || "table";
    logger.debug("Displaying streams", { format });

    switch (format) {
      case "json":
        output.print(JSON.stringify(streamList, null, 2));
        break;
      case "yaml":
        streamList.forEach((stream) => {
          output.print(`- ${stream}`);
        });
        break;
      case "csv":
        output.print("stream");
        streamList.forEach((stream) => {
          output.print(`"${stream}"`);
        });
        break;
      default: // table
        output.print(`Streams in pod '${options.pod}':`);
        output.print("─".repeat(30));
        streamList.forEach((stream) => {
          output.print(`/${stream}`);
        });
        output.print("─".repeat(30));
        output.print(
          `Total: ${streamList.length} stream${streamList.length === 1 ? "" : "s"}`,
        );
    }

    logger.info("Streams listed successfully", {
      pod: options.pod,
      count: streamList.length,
      format,
    });
  } catch (error: any) {
    logger.error("Streams command failed", {
      pod: options.pod,
      error: error.message,
    });
    output.error("Error: " + error.message);
    process.exit(1);
  }
}

/**
 * Delete an entire stream
 */
export async function deleteStream(
  options: DeleteStreamOptions,
): Promise<void> {
  const output = createCliOutput(options.quiet);

  try {
    logger.debug("Deleting stream", {
      pod: options.pod,
      stream: options.stream,
      force: options.force,
    });

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
  } catch (error: any) {
    logger.error("Delete stream command failed", {
      pod: options.pod,
      stream: options.stream,
      error: error.message,
    });
    output.error("Error: " + error.message);
    process.exit(1);
  }
}
