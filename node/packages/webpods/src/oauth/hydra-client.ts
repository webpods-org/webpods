/**
 * Hydra Admin API client configuration
 */

import { Configuration, OAuth2Api } from "@ory/hydra-client";
import { createLogger } from "../logger.js";
import { getConfig } from "../config-loader.js";

const logger = createLogger("webpods:oauth:hydra");

let hydraAdmin: OAuth2Api | null = null;

/**
 * Initialize Hydra admin client
 */
export function getHydraAdmin(): OAuth2Api {
  if (!hydraAdmin) {
    const config = getConfig();
    const hydraAdminUrl = config.hydra.adminUrl;

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
  const config = getConfig();
  return config.hydra.publicUrl;
}

/**
 * Get JWKS URL for token validation
 */
export function getJwksUrl(): string {
  return `${getHydraPublicUrl()}/.well-known/jwks.json`;
}
