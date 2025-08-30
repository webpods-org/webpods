/**
 * Common utilities for CLI commands
 */

import { Arguments } from "yargs";
import { getCurrentProfile, getProfile } from "../config/profiles.js";
import { loadConfig } from "../config/index.js";

export interface CommandConfig {
  server: string;
  token?: string;
}

/**
 * Get configuration with authentication from arguments or profile
 */
export async function getConfigWithAuth(
  argv: Arguments,
): Promise<CommandConfig> {
  // Check for profile flag
  let profile;
  if (argv.profile) {
    profile = await getProfile(argv.profile as string);
    if (!profile) {
      throw new Error(`Profile '${argv.profile}' not found`);
    }
  } else {
    profile = await getCurrentProfile();
  }

  // Build config from arguments or profile
  const server =
    (argv.server as string) || profile?.server || "http://localhost:3000";
  const token = (argv.token as string) || profile?.token;

  if (!token) {
    // Try legacy config
    const config = await loadConfig();
    if (config.token) {
      return { server, token: config.token };
    }
    throw new Error(
      "Not authenticated. Please run 'pod login' or 'pod token set <token>' first",
    );
  }

  return { server, token };
}

/**
 * Get configuration with optional authentication from arguments or profile
 */
export async function getConfig(argv: Arguments): Promise<CommandConfig> {
  // Check for profile flag
  let profile;
  if (argv.profile) {
    profile = await getProfile(argv.profile as string);
    if (!profile) {
      throw new Error(`Profile '${argv.profile}' not found`);
    }
  } else {
    profile = await getCurrentProfile();
  }

  // Build config from arguments or profile
  const server =
    (argv.server as string) || profile?.server || "http://localhost:3000";
  const token = (argv.token as string) || profile?.token;

  if (!token) {
    // Try legacy config
    const config = await loadConfig();
    if (config.token) {
      return { server, token: config.token };
    }
  }

  return { server, token };
}

/**
 * Simple HTTP client for direct API access
 */
export function getClient(config: CommandConfig) {
  const baseUrl = config.server;
  const token = config.token;

  return {
    async get(
      path: string,
      options: { headers?: Record<string, string> } = {},
    ): Promise<Response> {
      const url = path.startsWith("http") ? path : `${baseUrl}${path}`;
      const headers: Record<string, string> = {
        ...options.headers,
      };

      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      return fetch(url, {
        method: "GET",
        headers,
      });
    },

    async post(
      path: string,
      body: string | Buffer,
      options: { headers?: Record<string, string> } = {},
    ): Promise<Response> {
      const url = path.startsWith("http") ? path : `${baseUrl}${path}`;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...options.headers,
      };

      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      return fetch(url, {
        method: "POST",
        headers,
        body,
      });
    },

    async delete(
      path: string,
      options: { headers?: Record<string, string> } = {},
    ): Promise<Response> {
      const url = path.startsWith("http") ? path : `${baseUrl}${path}`;
      const headers: Record<string, string> = {
        ...options.headers,
      };

      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      return fetch(url, {
        method: "DELETE",
        headers,
      });
    },
  };
}
