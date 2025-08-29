/**
 * Profile management for WebPods CLI
 */

import { WebPodsConfig, WebPodsProfile } from "../types.js";
import { loadConfig, saveConfig } from "./index.js";
import { createLogger } from "../logger.js";

const logger = createLogger("webpods:cli:config:profiles");

/**
 * Get all profiles
 */
export async function getProfiles(): Promise<Record<string, WebPodsProfile>> {
  const config = await loadConfig();
  return config.profiles || {};
}

/**
 * Get current profile name
 */
export async function getCurrentProfileName(): Promise<string | undefined> {
  const config = await loadConfig();
  return config.currentProfile;
}

/**
 * Get current profile
 */
export async function getCurrentProfile(): Promise<WebPodsProfile | undefined> {
  const config = await loadConfig();

  // If no profiles exist but legacy config exists, create default profile
  if (!config.profiles || Object.keys(config.profiles).length === 0) {
    if (config.server) {
      return {
        name: "default",
        server: config.server,
        token: config.token,
        defaultPod: config.defaultPod,
        outputFormat: config.outputFormat,
      };
    }
    return undefined;
  }

  const profileName = config.currentProfile;
  if (!profileName) {
    // Use first profile if no current profile set
    const firstProfile = Object.keys(config.profiles)[0];
    return firstProfile ? config.profiles[firstProfile] : undefined;
  }

  return config.profiles[profileName];
}

/**
 * Get a specific profile
 */
export async function getProfile(
  name: string,
): Promise<WebPodsProfile | undefined> {
  const profiles = await getProfiles();
  return profiles[name];
}

/**
 * Add or update a profile
 */
export async function setProfile(profile: WebPodsProfile): Promise<void> {
  const config = await loadConfig();

  if (!config.profiles) {
    config.profiles = {};
  }

  config.profiles[profile.name] = profile;

  // Set as current if it's the only profile
  if (Object.keys(config.profiles).length === 1) {
    config.currentProfile = profile.name;
  }

  await saveConfig(config);
  logger.info("Profile saved", { name: profile.name });
}

/**
 * Delete a profile
 */
export async function deleteProfile(name: string): Promise<boolean> {
  const config = await loadConfig();

  if (!config.profiles || !config.profiles[name]) {
    return false;
  }

  delete config.profiles[name];

  // Update current profile if we deleted it
  if (config.currentProfile === name) {
    const remaining = Object.keys(config.profiles);
    config.currentProfile = remaining.length > 0 ? remaining[0] : undefined;
  }

  await saveConfig(config);
  logger.info("Profile deleted", { name });
  return true;
}

/**
 * Switch to a different profile
 */
export async function useProfile(name: string): Promise<boolean> {
  const config = await loadConfig();

  if (!config.profiles || !config.profiles[name]) {
    return false;
  }

  config.currentProfile = name;
  await saveConfig(config);
  logger.info("Switched to profile", { name });
  return true;
}

/**
 * List all profile names
 */
export async function listProfileNames(): Promise<string[]> {
  const profiles = await getProfiles();
  return Object.keys(profiles);
}

/**
 * Migrate legacy config to profile-based config
 */
export async function migrateLegacyConfig(): Promise<void> {
  const config = await loadConfig();

  // Check if we have legacy config but no profiles
  if (
    config.server &&
    (!config.profiles || Object.keys(config.profiles).length === 0)
  ) {
    logger.info("Migrating legacy config to profile");

    const defaultProfile: WebPodsProfile = {
      name: "default",
      server: config.server,
      token: config.token,
      defaultPod: config.defaultPod,
      outputFormat: config.outputFormat,
    };

    config.profiles = { default: defaultProfile };
    config.currentProfile = "default";

    // Clear legacy fields
    delete config.server;
    delete config.token;
    delete config.defaultPod;

    await saveConfig(config);
    logger.info("Legacy config migrated to default profile");
  }
}

/**
 * Update token for current profile
 */
export async function updateProfileToken(
  token: string,
  profileName?: string,
): Promise<void> {
  const config = await loadConfig();
  const targetProfile = profileName || config.currentProfile || "default";

  if (!config.profiles) {
    config.profiles = {};
  }

  if (!config.profiles[targetProfile]) {
    // Create profile if it doesn't exist
    config.profiles[targetProfile] = {
      name: targetProfile,
      server: "http://localhost:3000",
    };
  }

  config.profiles[targetProfile].token = token;

  // Set as current if needed
  if (!config.currentProfile) {
    config.currentProfile = targetProfile;
  }

  await saveConfig(config);
}

/**
 * Clear token for current profile
 */
export async function clearProfileToken(profileName?: string): Promise<void> {
  const config = await loadConfig();
  const targetProfile = profileName || config.currentProfile;

  if (targetProfile && config.profiles && config.profiles[targetProfile]) {
    delete config.profiles[targetProfile].token;
    await saveConfig(config);
  }
}
