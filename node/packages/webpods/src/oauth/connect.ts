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
import { getDb } from "../db/index.js";
import { createLogger } from "../logger.js";
import { getHydraPublicUrl } from "./hydra-client.js";
import { rateLimit } from "../middleware/ratelimit.js";
import { createSchema } from "@webpods/tinqer";
import { executeSelect } from "@webpods/tinqer-sql-pg-promise";
import type { DatabaseSchema } from "../db/schema.js";

const logger = createLogger("webpods:oauth:connect");
const router = Router();
const schema = createSchema<DatabaseSchema>();

/**
 * Simplified OAuth connection endpoint
 * GET /connect?client_id=example-app-123
 *
 * Redirects to Hydra OAuth with all necessary parameters
 */
router.get("/", rateLimit("read"), async (req: Request, res: Response) => {
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
    const clients = await executeSelect(
      db,
      schema,
      (q, p) =>
        q
          .from("oauth_client")
          .where((c) => c.client_id === p.clientId)
          .select((c) => c),
      { clientId },
    );

    const client = clients[0] || null;

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

    // Parse JSON fields stored as TEXT
    const redirect_uris =
      typeof client.redirect_uris === "string"
        ? JSON.parse(client.redirect_uris)
        : client.redirect_uris;
    const requested_pods =
      typeof client.requested_pods === "string"
        ? JSON.parse(client.requested_pods)
        : client.requested_pods;

    // Generate CSRF state with pods
    const nonce = crypto.randomBytes(16).toString("hex");
    const stateData = {
      nonce,
      pods: requested_pods,
      client_id: clientId,
    };
    const state = Buffer.from(JSON.stringify(stateData)).toString("base64");

    // Get Hydra URL
    const hydraPublicUrl = getHydraPublicUrl();

    // Construct Hydra OAuth authorization URL
    const hydraUrl = new URL(`${hydraPublicUrl}/oauth2/auth`);
    hydraUrl.searchParams.set("client_id", clientId);
    hydraUrl.searchParams.set("redirect_uri", redirect_uris[0] || ""); // Use first redirect URI
    hydraUrl.searchParams.set("response_type", "code");
    hydraUrl.searchParams.set(
      "scope",
      client.scope || "openid offline pod:read pod:write",
    );
    hydraUrl.searchParams.set("state", state);

    logger.info("Redirecting to Hydra OAuth", {
      clientId,
      clientName: client.client_name,
      requestedPods: requested_pods,
      redirectUri: redirect_uris[0],
    });

    // Redirect to Hydra
    res.redirect(hydraUrl.toString());
  } catch (error: unknown) {
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
