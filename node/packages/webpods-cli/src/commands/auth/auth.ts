/**
 * Authentication commands
 */

import { apiRequest } from "../../http/index.js";
import { 
  loadConfig, 
  clearToken, 
  setToken as saveToken, 
  getToken 
} from "../../config/index.js";
import { User, LoginArgs, TokenSetArgs, GlobalOptions } from "../../types.js";
import { createLogger, createCliOutput } from "../../logger.js";

const logger = createLogger("webpods:cli:auth");

/**
 * Print OAuth login link for manual token retrieval
 */
export async function login(options: LoginArgs): Promise<void> {
  const output = createCliOutput(options.quiet);
  
  try {
    logger.debug("Starting login process", { provider: options.provider });
    
    const config = await loadConfig();
    const server = options.server || config.server;
    const provider = options.provider || "github";
    
    const loginUrl = `${server}/auth/${provider}`;
    
    output.print("To authenticate with WebPods:");
    output.print(`1. Open this URL in your browser: ${loginUrl}`);
    output.print("2. Complete the OAuth flow");
    output.print("3. Copy the token from the success page");
    output.print("4. Run: pod token set <your-token>");
    output.print("");
    output.print("Note: The token will be displayed after successful authentication.");
    
    logger.info("Login URL provided", { loginUrl });
  } catch (error: any) {
    logger.error("Login failed", { error: error.message });
    output.error("Error: " + error.message);
    process.exit(1);
  }
}

/**
 * Clear stored authentication token
 */
export async function logout(options: GlobalOptions): Promise<void> {
  const output = createCliOutput(options.quiet);
  
  try {
    logger.debug("Logging out user");
    await clearToken();
    output.success("Logged out successfully. Token cleared.");
    logger.info("User logged out successfully");
  } catch (error: any) {
    logger.error("Logout failed", { error: error.message });
    output.error("Error: " + error.message);
    process.exit(1);
  }
}

/**
 * Show current authenticated user information
 */
export async function whoami(options: GlobalOptions): Promise<void> {
  const output = createCliOutput(options.quiet);
  
  try {
    logger.debug("Fetching current user info");
    
    const result = await apiRequest<User>("/auth/whoami", {
      token: options.token,
      server: options.server,
    });
    
    if (!result.success) {
      if (result.error.code === "UNAUTHORIZED" || result.error.code === "TOKEN_INVALID") {
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
        output.print(`${result.data.user_id},${result.data.email || ""},${result.data.name || ""},${result.data.provider}`);
        break;
      default: // table
        output.print(`User ID:  ${result.data.user_id}`);
        output.print(`Email:    ${result.data.email || "Not provided"}`);
        output.print(`Name:     ${result.data.name || "Not provided"}`);
        output.print(`Provider: ${result.data.provider}`);
    }
    
    logger.info("User info displayed", { userId: result.data.user_id, format });
  } catch (error: any) {
    logger.error("Whoami command failed", { error: error.message });
    output.error("Error: " + error.message);
    process.exit(1);
  }
}

/**
 * Display current stored token
 */
export async function token(options: GlobalOptions): Promise<void> {
  const output = createCliOutput(options.quiet);
  
  try {
    logger.debug("Displaying stored token");
    
    const storedToken = await getToken();
    
    if (!storedToken) {
      output.print("No token stored. Run 'pod login' to authenticate.");
      return;
    }
    
    // Only show first and last 8 characters for security
    const maskedToken = `${storedToken.slice(0, 8)}...${storedToken.slice(-8)}`;
    output.print(`Token: ${maskedToken}`);
    output.print("(Full token hidden for security)");
    
    logger.info("Token displayed (masked)");
  } catch (error: any) {
    logger.error("Token display failed", { error: error.message });
    output.error("Error: " + error.message);
    process.exit(1);
  }
}

/**
 * Manually set authentication token
 */
export async function tokenSet(options: TokenSetArgs): Promise<void> {
  const output = createCliOutput(options.quiet);
  
  try {
    logger.debug("Setting new token");
    
    if (!options.token || options.token.length < 10) {
      output.error("Invalid token provided");
      logger.warn("Invalid token provided", { tokenLength: options.token?.length });
      process.exit(1);
    }
    
    // Test the token by making a whoami request
    const result = await apiRequest<User>("/auth/whoami", {
      token: options.token,
      server: options.server,
    });
    
    if (!result.success) {
      output.error("Invalid token: " + result.error.message);
      logger.warn("Token validation failed", { error: result.error });
      process.exit(1);
    }
    
    await saveToken(options.token);
    output.success(`Token set successfully for user: ${result.data.name || result.data.email || result.data.user_id}`);
    logger.info("Token set successfully", { userId: result.data.user_id });
  } catch (error: any) {
    logger.error("Token set failed", { error: error.message });
    output.error("Error: " + error.message);
    process.exit(1);
  }
}