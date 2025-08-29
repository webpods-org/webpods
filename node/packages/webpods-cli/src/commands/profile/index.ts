/**
 * Profile management commands for WebPods CLI
 */

import { createCliOutput, createLogger } from "../../logger.js";
import {
  getProfiles,
  getCurrentProfileName,
  setProfile,
  deleteProfile,
  useProfile,
  listProfileNames,
  migrateLegacyConfig,
} from "../../config/profiles.js";
import { GlobalOptions, WebPodsProfile } from "../../types.js";
import chalk from "chalk";

const logger = createLogger("webpods:cli:profile");

interface ProfileAddOptions extends GlobalOptions {
  name: string;
  server: string;
}

interface ProfileUseOptions extends GlobalOptions {
  name: string;
}

interface ProfileDeleteOptions extends GlobalOptions {
  name: string;
  force?: boolean;
}

/**
 * List all profiles
 */
export async function profileList(options: GlobalOptions): Promise<void> {
  const output = createCliOutput(options.quiet);

  try {
    // Migrate legacy config if needed
    await migrateLegacyConfig();

    const profiles = await getProfiles();
    const currentProfile = await getCurrentProfileName();

    if (Object.keys(profiles).length === 0) {
      output.info(
        "No profiles configured. Create one with: pod profile add <name> --server <url>",
      );
      return;
    }

    if (options.format === "json") {
      output.json({ profiles, current: currentProfile });
      return;
    }

    output.info("Available profiles:");
    for (const [name, profile] of Object.entries(profiles)) {
      const isCurrent = name === currentProfile;
      const marker = isCurrent ? chalk.green("*") : " ";
      const token = profile.token
        ? chalk.gray("(authenticated)")
        : chalk.yellow("(no token)");
      output.info(
        `  ${marker} ${chalk.bold(name)} - ${profile.server} ${token}`,
      );
    }

    if (currentProfile) {
      output.info(`\nCurrent profile: ${chalk.bold(currentProfile)}`);
    }
  } catch (error: any) {
    logger.error("Failed to list profiles", { error });
    output.error("Failed to list profiles: " + error.message);
    process.exit(1);
  }
}

/**
 * Add a new profile
 */
export async function profileAdd(options: ProfileAddOptions): Promise<void> {
  const output = createCliOutput(options.quiet);

  try {
    // Validate server URL
    try {
      new URL(options.server);
    } catch {
      output.error("Invalid server URL. Must be a valid HTTP/HTTPS URL.");
      process.exit(1);
    }

    const profile: WebPodsProfile = {
      name: options.name,
      server: options.server,
    };

    await setProfile(profile);

    output.success(`Profile '${options.name}' added successfully.`);
    output.info(`Server: ${options.server}`);
    output.info(`\nTo use this profile: pod profile use ${options.name}`);
    output.info(`To authenticate: pod login --profile ${options.name}`);
  } catch (error: any) {
    logger.error("Failed to add profile", { error });
    output.error("Failed to add profile: " + error.message);
    process.exit(1);
  }
}

/**
 * Switch to a different profile
 */
export async function profileUse(options: ProfileUseOptions): Promise<void> {
  const output = createCliOutput(options.quiet);

  try {
    const success = await useProfile(options.name);

    if (!success) {
      output.error(`Profile '${options.name}' not found.`);
      const profiles = await listProfileNames();
      if (profiles.length > 0) {
        output.info(`Available profiles: ${profiles.join(", ")}`);
      }
      process.exit(1);
    }

    output.success(`Switched to profile '${options.name}'.`);

    // Show profile details
    const profiles = await getProfiles();
    const profile = profiles[options.name];
    if (profile) {
      output.info(`Server: ${profile.server}`);
      if (profile.token) {
        output.info(`Status: Authenticated`);
      } else {
        output.info(`Status: Not authenticated`);
        output.info(`\nTo authenticate: pod login`);
      }
    }
  } catch (error: any) {
    logger.error("Failed to switch profile", { error });
    output.error("Failed to switch profile: " + error.message);
    process.exit(1);
  }
}

/**
 * Delete a profile
 */
export async function profileDelete(
  options: ProfileDeleteOptions,
): Promise<void> {
  const output = createCliOutput(options.quiet);

  try {
    // Confirm deletion unless forced
    if (!options.force) {
      const readline = await import("readline");
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const answer = await new Promise<string>((resolve) => {
        rl.question(
          chalk.yellow(
            `Are you sure you want to delete profile '${options.name}'? (y/N): `,
          ),
          resolve,
        );
      });
      rl.close();

      if (answer.toLowerCase() !== "y") {
        output.info("Profile deletion cancelled.");
        return;
      }
    }

    const success = await deleteProfile(options.name);

    if (!success) {
      output.error(`Profile '${options.name}' not found.`);
      process.exit(1);
    }

    output.success(`Profile '${options.name}' deleted.`);
  } catch (error: any) {
    logger.error("Failed to delete profile", { error });
    output.error("Failed to delete profile: " + error.message);
    process.exit(1);
  }
}

/**
 * Show current profile
 */
export async function profileCurrent(options: GlobalOptions): Promise<void> {
  const output = createCliOutput(options.quiet);

  try {
    const currentName = await getCurrentProfileName();

    if (!currentName) {
      output.info("No current profile set.");
      output.info("Create one with: pod profile add <name> --server <url>");
      return;
    }

    const profiles = await getProfiles();
    const profile = profiles[currentName];

    if (!profile) {
      output.error(
        `Current profile '${currentName}' not found in configuration.`,
      );
      process.exit(1);
    }

    if (options.format === "json") {
      output.json({
        profileName: currentName,
        server: profile.server,
        token: profile.token,
        defaultPod: profile.defaultPod,
        outputFormat: profile.outputFormat,
      });
      return;
    }

    output.info(`Current profile: ${chalk.bold(currentName)}`);
    output.info(`Server: ${profile.server}`);
    output.info(
      `Status: ${profile.token ? "Authenticated" : "Not authenticated"}`,
    );
    if (profile.defaultPod) {
      output.info(`Default pod: ${profile.defaultPod}`);
    }
  } catch (error: any) {
    logger.error("Failed to get current profile", { error });
    output.error("Failed to get current profile: " + error.message);
    process.exit(1);
  }
}
