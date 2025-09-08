/**
 * Stream create command
 */

import { podRequest } from "../../http/index.js";
import { createLogger, createCliOutput } from "../../logger.js";

const logger = createLogger("webpods:cli:streams:create");

/**
 * Create a new stream in a pod
 */
export async function createStream(options: {
  pod: string;
  stream: string;
  access?: string;
  quiet?: boolean;
  token?: string;
  server?: string;
  profile?: string;
  [key: string]: unknown;
}): Promise<void> {
  const output = createCliOutput(options.quiet);

  try {
    logger.debug("Creating stream", {
      pod: options.pod,
      stream: options.stream,
      access: options.access,
    });

    if (!options.pod) {
      output.error("Pod name is required for creating a stream.");
      process.exit(1);
    }

    if (!options.stream) {
      output.error("Stream name is required.");
      process.exit(1);
    }

    // Validate access permission if provided
    const accessPermission = options.access || "public";
    
    // Check if it's a standard permission or a stream path
    const standardPermissions = ["public", "private"];
    const isStandardPermission = standardPermissions.includes(accessPermission);
    
    // If not a standard permission, it should be a stream path
    if (!isStandardPermission && !accessPermission.startsWith("/") && !accessPermission.startsWith(".")) {
      output.error(
        `Invalid access permission. Must be 'public', 'private', or a path to a permission stream (e.g., '/permissions/allowed-users')`,
      );
      process.exit(1);
    }

    // Create stream using POST with empty body
    // Add access permission as query parameter if not public
    const streamPath =
      accessPermission !== "public"
        ? `/${options.stream}?access=${accessPermission}`
        : `/${options.stream}`;

    const result = await podRequest(options.pod, streamPath, {
      method: "POST",
      body: "",
      token: options.token,
      server: options.server,
    });

    if (!result.success) {
      output.error("Error: " + result.error.message);
      logger.error("Stream creation failed", {
        pod: options.pod,
        stream: options.stream,
        error: result.error,
      });
      process.exit(1);
    }

    // Success message matching test expectations
    output.print(
      `Stream '${options.stream}' created successfully in pod '${options.pod}'.`,
    );
    if (accessPermission !== "public") {
      output.print(`Access permission: ${accessPermission}`);
    }

    logger.info("Stream created successfully", {
      pod: options.pod,
      stream: options.stream,
      access: accessPermission,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Stream create command failed", {
      pod: options.pod,
      stream: options.stream,
      error: errorMessage,
    });
    output.error("Error: " + errorMessage);
    process.exit(1);
  }
}
