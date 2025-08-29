/**
 * Configuration management for WebPods CLI
 */

import { promises as fs } from "fs";
import path from "path";
import { homedir } from "os";
import { WebPodsConfig, WebPodsProfile } from "../types.js";

const CONFIG_DIR = ".webpods";
const CONFIG_FILE = "config.json";

const DEFAULT_CONFIG: WebPodsConfig = {
  profiles: {},
  outputFormat: "table",
};

/**
 * Get the configuration directory path
 */
export function getConfigDir(): string {
  return path.resolve(homedir(), CONFIG_DIR);
}

/**
 * Get the configuration file path
 */
export function getConfigPath(): string {
  return path.resolve(getConfigDir(), CONFIG_FILE);
}

/**
 * Check if configuration file exists
 */
export async function configExists(): Promise<boolean> {
  try {
    await fs.access(getConfigPath());
    return true;
  } catch {
    return false;
  }
}

/**
 * Load configuration from file or return defaults
 */
export async function loadConfig(): Promise<WebPodsConfig> {
  try {
    const configPath = getConfigPath();
    const configData = await fs.readFile(configPath, "utf-8");
    const config = JSON.parse(configData) as Partial<WebPodsConfig>;

    return {
      ...DEFAULT_CONFIG,
      ...config,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

/**
 * Save configuration to file
 */
export async function saveConfig(config: WebPodsConfig): Promise<void> {
  const configDir = getConfigDir();
  const configPath = getConfigPath();

  // Ensure config directory exists
  try {
    await fs.mkdir(configDir, { recursive: true });
  } catch {
    // Directory might already exist
  }

  await fs.writeFile(configPath, JSON.stringify(config, null, 2));
}

/**
 * Update a specific config value
 */
export async function updateConfig(
  key: keyof WebPodsConfig,
  value: any,
): Promise<void> {
  const config = await loadConfig();
  (config as any)[key] = value;
  await saveConfig(config);
}

/**
 * Get a specific config value with fallback
 */
export async function getConfigValue<K extends keyof WebPodsConfig>(
  key: K,
  fallback?: WebPodsConfig[K],
): Promise<WebPodsConfig[K]> {
  const config = await loadConfig();
  return config[key] ?? fallback ?? DEFAULT_CONFIG[key];
}

/**
 * Clear stored token (legacy - redirects to profile)
 */
export async function clearToken(): Promise<void> {
  const { clearProfileToken } = await import("./profiles.js");
  await clearProfileToken();
}

/**
 * Set token (legacy - redirects to profile)
 */
export async function setToken(token: string): Promise<void> {
  const { updateProfileToken } = await import("./profiles.js");
  await updateProfileToken(token);
}

/**
 * Get stored token (legacy - redirects to profile)
 */
export async function getToken(): Promise<string | undefined> {
  const { getCurrentProfile } = await import("./profiles.js");
  const profile = await getCurrentProfile();
  return profile?.token;
}

// Export profile functions
export * from "./profiles.js";
