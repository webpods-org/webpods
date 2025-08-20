/**
 * Hydra Admin API client configuration
 */

import { Configuration, OAuth2Api } from "@ory/hydra-client";
import { createLogger } from "../logger.js";

const logger = createLogger("webpods:oauth:hydra");

let hydraAdmin: OAuth2Api | null = null;

/**
 * Initialize Hydra admin client
 */
export function getHydraAdmin(): OAuth2Api {
  if (!hydraAdmin) {
    const hydraAdminUrl =
      process.env.HYDRA_ADMIN_URL || "http://localhost:4445";

    const configuration = new Configuration({
      basePath: hydraAdminUrl,
    });

    hydraAdmin = new OAuth2Api(configuration);
    logger.info("Hydra admin client initialized", { adminUrl: hydraAdminUrl });
  }

  return hydraAdmin;
}

/**
 * Get Hydra public URL for JWKS
 */
export function getHydraPublicUrl(): string {
  return process.env.HYDRA_PUBLIC_URL || "http://localhost:4444";
}

/**
 * Get JWKS URL for token validation
 */
export function getJwksUrl(): string {
  return `${getHydraPublicUrl()}/.well-known/jwks.json`;
}
