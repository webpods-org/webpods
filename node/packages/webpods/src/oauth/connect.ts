/**
 * Simplified OAuth connection endpoint for third-party apps
 *
 * Instead of constructing complex OAuth URLs, apps can simply redirect to:
 * /connect?client_id=example-app-123
 *
 * This endpoint looks up the client, gets its registered pods and redirect URI,
 * and constructs the proper Hydra OAuth URL with all necessary parameters.
 */

import { Router, Request, Response } from "express";
import crypto from "crypto";
import { getDb } from "../db.js";
import { createLogger } from "../logger.js";
import { getHydraPublicUrl } from "./hydra-client.js";

const logger = createLogger("webpods:oauth:connect");
const router = Router();

// OAuth client DB row type
interface OAuthClientDbRow {
  id: string;
  user_id: string;
  client_id: string;
  client_name: string;
  client_secret: string | null;
  redirect_uris: string[];
  requested_pods: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: string;
  scope: string;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

/**
 * Simplified OAuth connection endpoint
 * GET /connect?client_id=example-app-123
 *
 * Redirects to Hydra OAuth with all necessary parameters
 */
router.get("/", async (req: Request, res: Response) => {
  const clientId = req.query.client_id as string;

  if (!clientId) {
    res.status(400).json({
      error: {
        code: "MISSING_CLIENT_ID",
        message: "client_id parameter is required",
      },
    });
    return;
  }

  try {
    const db = getDb();

    // Look up client in database
    const client = await db.oneOrNone<OAuthClientDbRow>(
      `SELECT * FROM oauth_client WHERE client_id = $(clientId)`,
      { clientId },
    );

    if (!client) {
      logger.warn("Unknown client attempted connection", { clientId });
      res.status(404).json({
        error: {
          code: "UNKNOWN_CLIENT",
          message: "Client not registered with WebPods",
        },
      });
      return;
    }

    // Generate CSRF state with pods
    const nonce = crypto.randomBytes(16).toString("hex");
    const stateData = {
      nonce,
      pods: client.requested_pods,
      client_id: clientId,
    };
    const state = Buffer.from(JSON.stringify(stateData)).toString("base64");

    // Get Hydra URL
    const hydraPublicUrl = getHydraPublicUrl();

    // Construct Hydra OAuth authorization URL
    const hydraUrl = new URL(`${hydraPublicUrl}/oauth2/auth`);
    hydraUrl.searchParams.set("client_id", clientId);
    hydraUrl.searchParams.set("redirect_uri", client.redirect_uris[0] || ""); // Use first redirect URI
    hydraUrl.searchParams.set("response_type", "code");
    hydraUrl.searchParams.set(
      "scope",
      client.scope || "openid offline pod:read pod:write",
    );
    hydraUrl.searchParams.set("state", state);

    logger.info("Redirecting to Hydra OAuth", {
      clientId,
      clientName: client.client_name,
      requestedPods: client.requested_pods,
      redirectUri: client.redirect_uris[0],
    });

    // Redirect to Hydra
    res.redirect(hydraUrl.toString());
  } catch (error) {
    logger.error("Connect endpoint error", {
      error: (error as Error).message,
      clientId,
    });

    res.status(500).json({
      error: {
        code: "INTERNAL_ERROR",
        message: "Failed to process connection request",
      },
    });
  }
});

export default router;
