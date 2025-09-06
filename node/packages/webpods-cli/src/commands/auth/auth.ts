/**
 * Authentication commands
 */

import { apiRequest } from "../../http/index.js";
import {
  loadConfig,
  clearToken,
  setToken as saveToken,
  getToken,
  saveConfig,
} from "../../config/index.js";
import { getCurrentProfile } from "../../config/profiles.js";
import { User, WebPodsProfile } from "../../types.js";
import { createLogger, createCliOutput } from "../../logger.js";

const logger = createLogger("webpods:cli:auth");

/**
 * Show available OAuth providers for authentication
 */
export async function login(options: {
  quiet?: boolean;
  [key: string]: unknown;
}): Promise<void> {
  const output = createCliOutput(options.quiet);

  try {
    logger.debug("Starting login process");

    // Get the current profile
    let profile = await getCurrentProfile();

    // If no profile exists, create default webpods profile
    if (!profile) {
      logger.info("No profile found, creating default 'webpods' profile");
      const config = await loadConfig();
      const webpodsProfile: WebPodsProfile = {
        name: "webpods",
        server: "https://webpods.org",
      };

      // Save the profile and set it as current
      config.profiles = { webpods: webpodsProfile };
      config.currentProfile = "webpods";
      await saveConfig(config);
      profile = webpodsProfile;

      output.print(
        "Created default profile 'webpods' pointing to https://webpods.org",
      );
      output.print(
        "To use a different server, run: pod profile add <name> --server <url>",
      );
      output.print("");
    }

    const server = profile.server;

    // Fetch available providers from the server
    const providersUrl = `${server}/auth/providers`;
    logger.debug("Fetching providers from", { url: providersUrl });

    try {
      const response = await apiRequest<{
        providers: Array<{ id: string; name: string; login_url: string }>;
      }>(providersUrl, { method: "GET" });

      if (!response.success) {
        // Can't connect to server or endpoint doesn't exist - use fallback
        throw new Error("Cannot fetch providers");
      }

      if (!response.data?.providers || response.data.providers.length === 0) {
        output.error("No authentication providers available on this server.");
        process.exit(1);
      }

      const providers = response.data.providers;

      // Show all available providers
      output.print("To authenticate with WebPods:");
      output.print("");
      providers.forEach((provider, index) => {
        output.print(
          `${index + 1}. Open this URL in your browser: ${provider.login_url}`,
        );
      });
      output.print("");
      output.print("After completing the OAuth flow, copy the token and run:");
      output.print("pod token set <your-token>");

      output.print("");
      output.print(
        "Note: The token will be displayed after successful authentication.",
      );
    } catch (fetchError) {
      // Fallback if endpoint doesn't exist or server is unreachable
      logger.warn("Could not fetch providers, using fallback", {
        error: fetchError,
      });

      // Show generic message when can't fetch providers
      output.print("To authenticate with WebPods:");
      output.print(`1. Visit your server's auth page: ${server}/auth/`);
      output.print("2. Choose an authentication provider");
      output.print("3. Complete the OAuth flow");
      output.print("4. Copy the token from the success page");
      output.print("5. Run: pod token set <your-token>");
      output.print("");
      output.print(
        "Note: The token will be displayed after successful authentication.",
      );
    }

    logger.info("Login URLs provided", { server });
    process.exit(0);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Login failed", { error: errorMessage });
    output.error("Error: " + errorMessage);
    process.exit(1);
  }
}

/**
 * Clear stored authentication token
 */
export async function logout(options: {
  quiet?: boolean;
  [key: string]: unknown;
}): Promise<void> {
  const output = createCliOutput(options.quiet);

  try {
    logger.debug("Logging out user");
    await clearToken();
    output.success("Logged out successfully. Token cleared.");
    logger.info("User logged out successfully");
    process.exit(0);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Logout failed", { error: errorMessage });
    output.error("Error: " + errorMessage);
    process.exit(1);
  }
}

/**
 * Show current authenticated user information
 */
export async function whoami(options: {
  quiet?: boolean;
  token?: string;
  server?: string;
  format?: string;
  [key: string]: unknown;
}): Promise<void> {
  const output = createCliOutput(options.quiet);

  try {
    logger.debug("Fetching current user info");

    const result = await apiRequest<User>("/auth/whoami", {
      token: options.token,
      server: options.server,
    });

    if (!result.success) {
      if (
        result.error.code === "UNAUTHORIZED" ||
        result.error.code === "TOKEN_INVALID"
      ) {
        output.error("Not authenticated. Run 'pod login' to authenticate.");
        logger.warn("User not authenticated", { error: result.error.code });
      } else {
        output.error("Error: " + result.error.message);
        logger.error("Whoami failed", { error: result.error });
      }
      process.exit(1);
    }

    const format = options.format || "table";

    switch (format) {
      case "json":
        output.print(JSON.stringify(result.data, null, 2));
        break;
      case "yaml":
        output.print(`user_id: ${result.data.user_id}`);
        output.print(`email: ${result.data.email || "null"}`);
        output.print(`name: ${result.data.name || "null"}`);
        output.print(`provider: ${result.data.provider}`);
        break;
      case "csv":
        output.print("user_id,email,name,provider");
        output.print(
          `${result.data.user_id},${result.data.email || ""},${result.data.name || ""},${result.data.provider}`,
        );
        break;
      default: // table
        output.print(`User ID:  ${result.data.user_id}`);
        output.print(`Email:    ${result.data.email || "Not provided"}`);
        output.print(`Name:     ${result.data.name || "Not provided"}`);
        output.print(`Provider: ${result.data.provider}`);
    }

    logger.info("User info displayed", { userId: result.data.user_id, format });
    process.exit(0);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Whoami command failed", { error: errorMessage });
    output.error("Error: " + errorMessage);
    process.exit(1);
  }
}

/**
 * Display current stored token
 */
export async function token(options: {
  quiet?: boolean;
  [key: string]: unknown;
}): Promise<void> {
  const output = createCliOutput(options.quiet);

  try {
    logger.debug("Displaying stored token");

    const storedToken = await getToken();

    if (!storedToken) {
      output.print("No token stored. Run 'pod login' to authenticate.");
      process.exit(0);
      return;
    }

    // Only show first and last 8 characters for security
    const maskedToken = `${storedToken.slice(0, 8)}...${storedToken.slice(-8)}`;
    output.print(`Token: ${maskedToken}`);
    output.print("(Full token hidden for security)");

    logger.info("Token displayed (masked)");
    process.exit(0);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Token display failed", { error: errorMessage });
    output.error("Error: " + errorMessage);
    process.exit(1);
  }
}

/**
 * Manually set authentication token
 */
export async function tokenSet(options: {
  quiet?: boolean;
  token?: string;
  [key: string]: unknown;
}): Promise<void> {
  const output = createCliOutput(options.quiet);

  try {
    logger.debug("Setting new token");

    if (!options.token || options.token.length < 10) {
      output.error("Invalid token provided");
      logger.warn("Invalid token provided", {
        tokenLength: options.token?.length,
      });
      process.exit(1);
    }

    // Get current profile to get server
    const profile = await getCurrentProfile();
    if (!profile) {
      output.error(
        "No profile configured. Run 'pod profile add <name> --server <url>' to configure a server.",
      );
      process.exit(1);
    }

    // Test the token by making a whoami request
    const result = await apiRequest<User>("/auth/whoami", {
      token: options.token,
      server: profile.server,
    });

    if (!result.success) {
      output.error("Invalid token: " + result.error.message);
      logger.warn("Token validation failed", { error: result.error });
      process.exit(1);
    }

    await saveToken(options.token);
    output.success(
      `Token set successfully for user: ${result.data.name || result.data.email || result.data.user_id}`,
    );
    logger.info("Token set successfully", { userId: result.data.user_id });
    process.exit(0);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Token set failed", { error: errorMessage });
    output.error("Error: " + errorMessage);
    process.exit(1);
  }
}
