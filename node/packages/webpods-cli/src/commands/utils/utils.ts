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
    const currentProfile = currentConfig.currentProfile;
    const profile =
      currentProfile && currentConfig.profiles
        ? currentConfig.profiles[currentProfile]
        : null;

    output.print("WebPods CLI Configuration:");
    output.print("─".repeat(30));

    if (profile) {
      output.print(`Current Profile: ${currentProfile}`);
      output.print(`Server:          ${profile.server}`);
      output.print(`Token:           ${profile.token ? "Set" : "Not set"}`);
      output.print(
        `Output Format:   ${profile.outputFormat || currentConfig.outputFormat || "table"}`,
      );
      output.print(`Default Pod:     ${profile.defaultPod || "Not set"}`);
    } else {
      output.print("No profile configured.");
      output.print(
        "Run 'podctl profile add <name> --server <url>' to get started.",
      );
    }

    output.print("\nConfiguration file: ~/.webpods/config.json");
    output.print("To manage profiles: podctl profile list");

    logger.info("Configuration displayed", {
      currentProfile,
      hasProfile: !!profile,
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

    const validKeys = ["outputFormat", "defaultPod"] as const;
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
