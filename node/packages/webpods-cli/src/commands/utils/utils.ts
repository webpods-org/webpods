/**
 * Utility commands (config, etc.)
 */

import { loadConfig, updateConfig } from "../../config/index.js";
import { createLogger, createCliOutput } from "../../logger.js";

const logger = createLogger("webpods:cli:utils");

/**
 * Show current configuration
 */
export async function config(options: {
  quiet?: boolean;
  [key: string]: unknown;
}): Promise<void> {
  const output = createCliOutput(options.quiet);

  try {
    logger.debug("Displaying configuration");

    const currentConfig = await loadConfig();

    output.print("WebPods CLI Configuration:");
    output.print("─".repeat(30));
    output.print(`Server:        ${currentConfig.server}`);
    output.print(`Output Format: ${currentConfig.outputFormat}`);
    output.print(`Token:         ${currentConfig.token ? "Set" : "Not set"}`);
    output.print(`Default Pod:   ${currentConfig.defaultPod || "Not set"}`);

    output.print("\nConfiguration file: ~/.webpods/config.json");

    logger.info("Configuration displayed", {
      server: currentConfig.server,
      outputFormat: currentConfig.outputFormat,
      hasToken: !!currentConfig.token,
      defaultPod: currentConfig.defaultPod,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Config command failed", { error: errorMessage });
    output.error("Error: " + errorMessage);
    process.exit(1);
  }
}

/**
 * Set a configuration value
 */
export async function configSet(options: {
  quiet?: boolean;
  key?: string;
  value?: string;
  [key: string]: unknown;
}): Promise<void> {
  const output = createCliOutput(options.quiet);

  try {
    logger.debug("Setting configuration", {
      key: options.key,
      value: options.value,
    });

    const validKeys = ["server", "outputFormat", "defaultPod"] as const;
    type ValidKey = (typeof validKeys)[number];

    if (
      !options.key ||
      !(validKeys as readonly string[]).includes(options.key)
    ) {
      output.error(`Invalid configuration key: ${options.key || "undefined"}`);
      output.error(`Valid keys: ${validKeys.join(", ")}`);
      logger.error("Invalid configuration key", {
        key: options.key,
        validKeys: [...validKeys],
      });
      process.exit(1);
    }

    await updateConfig(options.key as ValidKey, options.value);
    output.success(`Configuration updated: ${options.key} = ${options.value}`);
    logger.info("Configuration updated", {
      key: options.key,
      value: options.value,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Config set command failed", {
      key: options.key,
      value: options.value,
      error: errorMessage,
    });
    output.error("Error: " + errorMessage);
    process.exit(1);
  }
}

/**
 * Set WebPods server URL
 */
export async function configServer(options: {
  quiet?: boolean;
  url?: string;
  [key: string]: unknown;
}): Promise<void> {
  const output = createCliOutput(options.quiet);

  try {
    logger.debug("Setting server URL", { url: options.url });

    // Basic URL validation
    if (!options.url) {
      output.error("URL is required");
      logger.error("No URL provided for server config");
      process.exit(1);
    }
    try {
      new URL(options.url);
    } catch {
      output.error("Invalid URL provided");
      logger.error("Invalid URL provided for server config", {
        url: options.url,
      });
      process.exit(1);
    }

    await updateConfig("server", options.url);
    output.success(`Server URL updated: ${options.url}`);
    logger.info("Server URL updated", { url: options.url });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Config server command failed", {
      url: options.url,
      error: errorMessage,
    });
    output.error("Error: " + errorMessage);
    process.exit(1);
  }
}
