/**
 * Dynamic OAuth client registration
 */

import { Router, Request, Response } from "express";
import { getHydraAdmin } from "./hydra-client.js";
import { createLogger } from "../logger.js";
import { z } from "zod";

const logger = createLogger("webpods:oauth:registration");
const router = Router();

// Validation schema for client registration
const registrationSchema = z.object({
  client_name: z.string().min(1).max(255),
  redirect_uris: z.array(z.string().url()),
  grant_types: z
    .array(z.enum(["authorization_code", "refresh_token"]))
    .optional(),
  response_types: z.array(z.enum(["code", "token"])).optional(),
  scope: z.string().optional(),
  token_endpoint_auth_method: z.enum(["none", "client_secret_post"]).optional(),
  application_type: z.enum(["web", "native"]).optional(),
  contacts: z.array(z.string().email()).optional(),
  logo_uri: z.string().url().optional(),
  client_uri: z.string().url().optional(),
  policy_uri: z.string().url().optional(),
  tos_uri: z.string().url().optional(),
});

/**
 * Register a new OAuth client
 * POST /oauth/register
 */
router.post("/register", async (req: Request, res: Response) => {
  try {
    // Validate request body
    const validationResult = registrationSchema.safeParse(req.body);

    if (!validationResult.success) {
      res.status(400).json({
        error: {
          code: "INVALID_REQUEST",
          message: "Invalid registration request",
          details: validationResult.error.issues,
        },
      });
      return;
    }

    const clientData = validationResult.data;
    const hydraAdmin = getHydraAdmin();

    // Create OAuth client in Hydra
    const { data: client } = await hydraAdmin.createOAuth2Client({
      oAuth2Client: {
        client_name: clientData.client_name,
        redirect_uris: clientData.redirect_uris,
        grant_types: clientData.grant_types || [
          "authorization_code",
          "refresh_token",
        ],
        response_types: clientData.response_types || ["code"],
        scope: clientData.scope || "openid offline pod:read pod:write",
        token_endpoint_auth_method:
          clientData.token_endpoint_auth_method || "none",
        metadata: {
          application_type: clientData.application_type || "web",
          contacts: clientData.contacts,
          logo_uri: clientData.logo_uri,
          client_uri: clientData.client_uri,
          policy_uri: clientData.policy_uri,
          tos_uri: clientData.tos_uri,
          registered_at: new Date().toISOString(),
        },
      },
    });

    logger.info("Client registered successfully");

    // Return client credentials
    res.status(201).json({
      client_id: client.client_id,
      client_secret: client.client_secret || undefined,
      client_name: client.client_name,
      redirect_uris: client.redirect_uris,
      grant_types: client.grant_types,
      response_types: client.response_types,
      scope: client.scope,
      token_endpoint_auth_method: client.token_endpoint_auth_method,
    });
  } catch (error: unknown) {
    logger.error("Client registration failed", {
      error: (error as Error).message,
      details: (error as { response?: { data?: unknown } })?.response?.data,
    });

    if (
      (error as { response?: { status?: number } })?.response?.status === 409
    ) {
      res.status(409).json({
        error: {
          code: "CLIENT_EXISTS",
          message: "Client with this configuration already exists",
        },
      });
    } else {
      res.status(500).json({
        error: {
          code: "REGISTRATION_ERROR",
          message: "Failed to register client",
        },
      });
    }
  }
});

/**
 * Get client information
 * GET /oauth/client/:clientId
 */
router.get("/client/:clientId", async (req: Request, res: Response) => {
  const { clientId } = req.params;

  try {
    const hydraAdmin = getHydraAdmin();
    const { data: client } = await hydraAdmin.getOAuth2Client({
      id: clientId || "",
    });

    // Return public client information only
    res.json({
      client_id: client.client_id,
      client_name: client.client_name,
      logo_uri: (client.metadata as Record<string, unknown> | undefined)
        ?.logo_uri as string | undefined,
      client_uri: (client.metadata as Record<string, unknown> | undefined)
        ?.client_uri as string | undefined,
      policy_uri: (client.metadata as Record<string, unknown> | undefined)
        ?.policy_uri as string | undefined,
      tos_uri: (client.metadata as Record<string, unknown> | undefined)
        ?.tos_uri as string | undefined,
      scope: client.scope,
    });
  } catch (error: unknown) {
    if (
      (error as { response?: { status?: number } })?.response?.status === 404
    ) {
      res.status(404).json({
        error: {
          code: "CLIENT_NOT_FOUND",
          message: "Client not found",
        },
      });
    } else {
      logger.error("Failed to get client", {
        error: (error as Error).message,
        clientId,
      });
      res.status(500).json({
        error: {
          code: "SERVER_ERROR",
          message: "Failed to retrieve client information",
        },
      });
    }
  }
});

export default router;
