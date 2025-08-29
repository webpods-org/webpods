/**
 * Pod management commands
 */

import { apiRequest } from "../../http/index.js";
import { Pod, GlobalOptions } from "../../types.js";
import { createLogger, createCliOutput } from "../../logger.js";

const logger = createLogger("webpods:cli:pods");

interface CreatePodOptions extends GlobalOptions {
  name: string;
}

interface DeletePodOptions extends GlobalOptions {
  pod: string;
  force?: boolean;
}

interface InfoPodOptions extends GlobalOptions {
  pod: string;
}

/**
 * Create a new pod
 */
export async function createPod(options: CreatePodOptions): Promise<void> {
  const output = createCliOutput(options.quiet);

  try {
    logger.debug("Creating pod", { name: options.name });

    // Validate pod name
    if (!/^[a-z0-9-]+$/.test(options.name)) {
      output.error(
        "Invalid pod name. Use only lowercase letters, numbers, and hyphens.",
      );
      logger.warn("Invalid pod name format", { name: options.name });
      process.exit(1);
    }

    if (options.name.length < 2 || options.name.length > 63) {
      output.error("Pod name must be between 2 and 63 characters.");
      logger.warn("Invalid pod name length", {
        name: options.name,
        length: options.name.length,
      });
      process.exit(1);
    }

    // Use the explicit pod creation API
    const result = await apiRequest<any>("/api/pods", {
      method: "POST",
      body: {
        name: options.name,
      },
      token: options.token,
      server: options.server,
      profile: options.profile,
    });

    if (!result.success) {
      const errorMessage =
        result.error?.message ||
        JSON.stringify(result.error) ||
        "Pod creation failed";
      output.error("Error: " + errorMessage);
      logger.error("Pod creation failed", {
        name: options.name,
        error: result.error,
      });
      process.exit(1);
    }

    output.success(`Pod '${options.name}' created successfully!`);
    logger.info("Pod created successfully", {
      name: options.name,
      podId: result.data.id,
    });
  } catch (error: any) {
    const errorMessage =
      error?.message || String(error) || "Pod creation failed";
    logger.error("Pod creation command failed", { error: errorMessage });
    output.error("Error: " + errorMessage);
    process.exit(1);
  }
}

/**
 * List all user's pods
 */
export async function listPods(options: GlobalOptions): Promise<void> {
  const output = createCliOutput(options.quiet);

  try {
    logger.debug("Listing pods");

    const result = await apiRequest<Pod[]>("/api/pods", {
      token: options.token,
      server: options.server,
      profile: options.profile,
    });

    if (!result.success) {
      output.error("Error: " + result.error.message);
      logger.error("Pod listing failed", { error: result.error });
      process.exit(1);
    }

    const pods = result.data;
    logger.debug("Retrieved pods", { count: pods.length });

    if (pods.length === 0) {
      // For JSON format, output empty array instead of message
      if (options.format === "json") {
        output.print("[]");
      } else {
        output.print("No pods found. Create one with 'pod create <name>'");
      }
      return;
    }

    const format = options.format || "table";
    logger.debug("Displaying pods", { format });

    switch (format) {
      case "json":
        output.print(JSON.stringify(pods, null, 2));
        break;
      case "yaml":
        pods.forEach((pod, index) => {
          if (index > 0) output.print("---");
          output.print(`name: ${pod.name}`);
          output.print(`id: ${pod.id}`);
          output.print(`created_at: ${pod.created_at}`);
        });
        break;
      case "csv":
        output.print("name,id,created_at");
        pods.forEach((pod) => {
          output.print(`${pod.name},${pod.id},${pod.created_at}`);
        });
        break;
      default: // table
        output.print("Pods:");
        output.print("─────");
        pods.forEach((pod) => {
          output.print(pod.name);
        });
        output.print(
          `\nTotal: ${pods.length} pod${pods.length === 1 ? "" : "s"}`,
        );
    }

    logger.info("Pods listed successfully", { count: pods.length, format });
  } catch (error: any) {
    logger.error("List pods command failed", { error: error.message });
    output.error("Error: " + error.message);
    process.exit(1);
  }
}

/**
 * Delete a pod and all its data
 */
export async function deletePod(options: DeletePodOptions): Promise<void> {
  const output = createCliOutput(options.quiet);

  try {
    logger.debug("Deleting pod", { pod: options.pod, force: options.force });

    if (!options.force) {
      // In a real CLI, we'd use a proper prompt library
      output.print(
        `WARNING: This will permanently delete pod '${options.pod}' and ALL its data.`,
      );
      output.print("This action cannot be undone!");
      output.print("Use --force to skip this confirmation.");
      logger.info("Pod deletion cancelled - confirmation required", {
        pod: options.pod,
      });
      process.exit(0);
    }

    // Use podRequest to hit the pod subdomain delete endpoint
    const { podRequest } = await import("../../http/index.js");
    const result = await podRequest<void>(
      options.pod,
      "/", // DELETE / on the pod subdomain deletes the pod
      {
        method: "DELETE",
        token: options.token,
        server: options.server,
      },
    );

    if (!result.success) {
      if (result.error.code === "NOT_FOUND") {
        output.error(`Pod '${options.pod}' not found.`);
        logger.warn("Pod not found for deletion", { pod: options.pod });
      } else {
        output.error("Error: " + result.error.message);
        logger.error("Pod deletion failed", {
          pod: options.pod,
          error: result.error,
        });
      }
      process.exit(1);
    }

    output.success(`Pod '${options.pod}' deleted successfully.`);
    logger.info("Pod deleted successfully", { pod: options.pod });
  } catch (error: any) {
    logger.error("Delete pod command failed", {
      pod: options.pod,
      error: error.message,
    });
    output.error("Error: " + error.message);
    process.exit(1);
  }
}

/**
 * Show pod details and statistics
 */
export async function infoPod(options: InfoPodOptions): Promise<void> {
  const output = createCliOutput(options.quiet);

  try {
    logger.debug("Getting pod info", { pod: options.pod });

    // Use podRequest to get pod info via .meta/streams
    const { podRequest } = await import("../../http/index.js");
    const result = await podRequest<any>(
      options.pod,
      "/.meta/streams", // GET /.meta/streams lists streams in the pod
      {
        token: options.token,
        server: options.server,
      },
    );

    if (!result.success) {
      if (result.error.code === "NOT_FOUND") {
        output.error(`Pod '${options.pod}' not found.`);
        logger.warn("Pod not found for info", { pod: options.pod });
      } else {
        output.error("Error: " + result.error.message);
        logger.error("Pod info failed", {
          pod: options.pod,
          error: result.error,
        });
      }
      process.exit(1);
    }

    const info = result.data;
    const format = options.format || "table";
    logger.debug("Displaying pod info", { pod: options.pod, format });

    switch (format) {
      case "json":
        output.print(JSON.stringify(info, null, 2));
        break;
      case "yaml":
        Object.entries(info).forEach(([key, value]) => {
          output.print(`${key}: ${value}`);
        });
        break;
      case "csv":
        output.print("key,value");
        Object.entries(info).forEach(([key, value]) => {
          output.print(`${key},${value}`);
        });
        break;
      default: // table
        output.print(`Pod: ${options.pod}`);
        output.print("─".repeat(20 + options.pod.length));
        output.print(`ID:          ${info.id || "Unknown"}`);
        output.print(`Created:     ${info.created_at || "Unknown"}`);
        output.print(`Streams:     ${info.stream_count || 0}`);
        output.print(`Records:     ${info.record_count || 0}`);
        output.print(`Size:        ${info.total_size || "Unknown"}`);
    }

    logger.info("Pod info displayed", { pod: options.pod, format });
  } catch (error: any) {
    logger.error("Info pod command failed", {
      pod: options.pod,
      error: error.message,
    });
    output.error("Error: " + error.message);
    process.exit(1);
  }
}
