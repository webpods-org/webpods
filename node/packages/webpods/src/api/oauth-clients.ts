/**
 * OAuth client management API
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import crypto from "crypto";
import { getDb } from "../db/index.js";
import { getHydraAdmin } from "../oauth/hydra-client.js";
import { requireWebPodsJWT } from "../middleware/webpods-jwt.js";
import { rateLimit } from "../middleware/ratelimit.js";
import { createLogger } from "../logger.js";

const logger = createLogger("webpods:api:oauth-clients");
const router = Router();

// OAuth client DB row type
interface OAuthClientDbRow {
  id: string | number; // bigserial - string when returned from DB
  user_id: string;
  client_id: string;
  client_name: string;
  client_secret: string | null;
  redirect_uris: string; // TEXT storing JSON array
  requested_pods: string; // TEXT storing JSON array
  grant_types: string; // TEXT storing JSON array
  response_types: string; // TEXT storing JSON array
  token_endpoint_auth_method: string;
  scope: string;
  metadata: string; // TEXT storing JSON
  created_at: number; // BIGINT timestamp
  updated_at: number; // BIGINT timestamp
}

// Validation schema for client creation
const createClientSchema = z.object({
  client_name: z.string().min(1).max(255),
  redirect_uris: z.array(z.string().url()).min(1),
  requested_pods: z.array(z.string().min(1)).min(1), // Required, at least one pod
  grant_types: z
    .array(z.enum(["authorization_code", "refresh_token"]))
    .optional()
    .default(["authorization_code", "refresh_token"]),
  response_types: z
    .array(z.enum(["code", "token"]))
    .optional()
    .default(["code"]),
  token_endpoint_auth_method: z
    .enum(["none", "client_secret_basic", "client_secret_post"])
    .optional()
    .default("client_secret_basic"),
  scope: z.string().optional().default("openid offline pod:read pod:write"),
});

/**
 * Generate a unique client ID
 */
function generateClientId(clientName: string): string {
  // Create slug from client name
  const slug = clientName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 50);

  // Add random suffix
  const suffix = crypto.randomBytes(4).toString("hex");
  return `${slug}-${suffix}`;
}

/**
 * Generate a secure client secret
 */
function generateClientSecret(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/**
 * Create a new OAuth client
 * POST /api/oauth/clients
 */
router.post(
  "/clients",
  requireWebPodsJWT,
  rateLimit("write"),
  async (req: Request, res: Response) => {
    try {
      const userId = req.user!.id;

      // Validate request body
      const validationResult = createClientSchema.safeParse(req.body);

      if (!validationResult.success) {
        res.status(400).json({
          error: {
            code: "INVALID_REQUEST",
            message: "Invalid client configuration",
            details: validationResult.error.issues,
          },
        });
        return;
      }

      const clientData = validationResult.data;
      const db = getDb();

      // Generate client credentials
      const clientId = generateClientId(clientData.client_name);
      const clientSecret =
        clientData.token_endpoint_auth_method === "none"
          ? null
          : generateClientSecret();

      // Create client in Hydra
      const hydraAdmin = getHydraAdmin();

      try {
        await hydraAdmin.createOAuth2Client({
          oAuth2Client: {
            client_id: clientId,
            client_secret: clientSecret || undefined,
            client_name: clientData.client_name,
            redirect_uris: clientData.redirect_uris,
            grant_types: clientData.grant_types,
            response_types: clientData.response_types,
            scope: clientData.scope,
            token_endpoint_auth_method: clientData.token_endpoint_auth_method,
            metadata: {
              owner_id: userId,
              created_at: new Date().toISOString(),
            },
          },
        });

        logger.info("Created OAuth client in Hydra");

        // Store client in our database
        const now = Date.now();
        const clientRecord = await db.one<OAuthClientDbRow>(
          `INSERT INTO oauth_client (
          user_id,
          client_id,
          client_name,
          client_secret,
          redirect_uris,
          requested_pods,
          grant_types,
          response_types,
          token_endpoint_auth_method,
          scope,
          metadata,
          created_at,
          updated_at
        ) VALUES (
          $(user_id),
          $(client_id),
          $(client_name),
          $(client_secret),
          $(redirect_uris),
          $(requested_pods),
          $(grant_types),
          $(response_types),
          $(token_endpoint_auth_method),
          $(scope),
          $(metadata),
          $(created_at),
          $(updated_at)
        ) RETURNING *`,
          {
            user_id: userId,
            client_id: clientId,
            client_name: clientData.client_name,
            client_secret: clientSecret,
            redirect_uris: JSON.stringify(clientData.redirect_uris),
            requested_pods: JSON.stringify(clientData.requested_pods),
            grant_types: JSON.stringify(clientData.grant_types),
            response_types: JSON.stringify(clientData.response_types),
            token_endpoint_auth_method: clientData.token_endpoint_auth_method,
            scope: clientData.scope,
            metadata: JSON.stringify({}),
            created_at: now,
            updated_at: now,
          },
        );

        // Return client info (including secret only on creation)
        res.status(201).json({
          id: clientRecord.id,
          client_id: clientId,
          client_secret: clientSecret,
          client_name: clientData.client_name,
          redirect_uris: clientData.redirect_uris,
          requested_pods: clientData.requested_pods,
          grant_types: clientData.grant_types,
          response_types: clientData.response_types,
          token_endpoint_auth_method: clientData.token_endpoint_auth_method,
          scope: clientData.scope,
          created_at: clientRecord.created_at,
        });
      } catch (error) {
        logger.error("Failed to create OAuth client in Hydra", {
          error: (error as Error).message,
          details: (error as { response?: { data?: unknown } })?.response?.data,
          status: (error as { response?: { status?: number } })?.response
            ?.status,
          statusText: (error as { response?: { statusText?: string } })
            ?.response?.statusText,
          userId,
          clientId,
          clientName: clientData.client_name,
          hydraError:
            (error as { response?: { data?: unknown } })?.response?.data ||
            (error as Error).message,
        });

        // If Hydra creation fails, don't create in our DB
        if (
          (error as { response?: { status?: number } })?.response?.status ===
          409
        ) {
          res.status(409).json({
            error: {
              code: "CLIENT_EXISTS",
              message: "A client with this ID already exists",
            },
          });
        } else {
          res.status(500).json({
            error: {
              code: "CLIENT_CREATION_ERROR",
              message: "Failed to create OAuth client",
            },
          });
        }
      }
    } catch (error) {
      logger.error("OAuth client creation error", {
        error: (error as Error).message,
        userId: req.user?.id,
      });

      res.status(500).json({
        error: {
          code: "INTERNAL_ERROR",
          message: "An error occurred while creating the client",
        },
      });
    }
  },
);

/**
 * List user's OAuth clients
 * GET /api/oauth/clients
 */
router.get(
  "/clients",
  requireWebPodsJWT,
  rateLimit("read"),
  async (req: Request, res: Response) => {
    try {
      const userId = req.user!.id;
      const db = getDb();

      const clients = await db.manyOrNone<OAuthClientDbRow>(
        `SELECT * FROM oauth_client 
       WHERE user_id = $(user_id)
       ORDER BY created_at DESC`,
        { user_id: userId },
      );

      // Don't return client secrets in list
      const clientList = clients.map((client) => ({
        id: client.id,
        client_id: client.client_id,
        client_name: client.client_name,
        redirect_uris: JSON.parse(client.redirect_uris),
        grant_types: JSON.parse(client.grant_types),
        response_types: JSON.parse(client.response_types),
        token_endpoint_auth_method: client.token_endpoint_auth_method,
        scope: client.scope,
        created_at: client.created_at,
        updated_at: client.updated_at,
      }));

      res.json({
        clients: clientList,
        total: clientList.length,
      });
    } catch (error) {
      logger.error("Failed to list OAuth clients", {
        error: (error as Error).message,
        userId: req.user?.id,
      });

      res.status(500).json({
        error: {
          code: "LIST_ERROR",
          message: "Failed to retrieve OAuth clients",
        },
      });
    }
  },
);

/**
 * Get a specific OAuth client
 * GET /api/oauth/clients/:clientId
 */
router.get(
  "/clients/:clientId",
  requireWebPodsJWT,
  rateLimit("read"),
  async (req: Request, res: Response) => {
    try {
      const userId = req.user!.id;
      const { clientId } = req.params;
      const db = getDb();

      const client = await db.oneOrNone<OAuthClientDbRow>(
        `SELECT * FROM oauth_client 
       WHERE client_id = $(client_id) AND user_id = $(user_id)`,
        { client_id: clientId, user_id: userId },
      );

      if (!client) {
        res.status(404).json({
          error: {
            code: "CLIENT_NOT_FOUND",
            message: "OAuth client not found",
          },
        });
        return;
      }

      // Don't return client secret
      res.json({
        id: client.id,
        client_id: client.client_id,
        client_name: client.client_name,
        redirect_uris: JSON.parse(client.redirect_uris),
        grant_types: JSON.parse(client.grant_types),
        response_types: JSON.parse(client.response_types),
        token_endpoint_auth_method: client.token_endpoint_auth_method,
        scope: client.scope,
        created_at: client.created_at,
        updated_at: client.updated_at,
      });
    } catch (error) {
      logger.error("Failed to get OAuth client", {
        error: (error as Error).message,
        userId: req.user?.id,
        clientId: req.params.clientId,
      });

      res.status(500).json({
        error: {
          code: "GET_ERROR",
          message: "Failed to retrieve OAuth client",
        },
      });
    }
  },
);

/**
 * Delete an OAuth client
 * DELETE /api/oauth/clients/:clientId
 */
router.delete(
  "/clients/:clientId",
  requireWebPodsJWT,
  rateLimit("write"),
  async (req: Request, res: Response) => {
    try {
      const userId = req.user!.id;
      const { clientId } = req.params;
      const db = getDb();

      // Check if client exists and belongs to user
      const client = await db.oneOrNone<OAuthClientDbRow>(
        `SELECT * FROM oauth_client 
       WHERE client_id = $(client_id) AND user_id = $(user_id)`,
        { client_id: clientId, user_id: userId },
      );

      if (!client) {
        res.status(404).json({
          error: {
            code: "CLIENT_NOT_FOUND",
            message: "OAuth client not found",
          },
        });
        return;
      }

      // Delete from Hydra
      const hydraAdmin = getHydraAdmin();

      try {
        await hydraAdmin.deleteOAuth2Client({ id: clientId || "" });
        logger.info("Deleted OAuth client from Hydra");
      } catch (error) {
        // If already deleted from Hydra, continue
        if (
          (error as { response?: { status?: number } })?.response?.status !==
          404
        ) {
          logger.error("Failed to delete from Hydra", {
            error: (error as Error).message,
            clientId,
          });
          res.status(500).json({
            error: {
              code: "DELETE_ERROR",
              message:
                "Failed to delete OAuth client from authorization server",
            },
          });
          return;
        }
      }

      // Delete from our database
      await db.none(
        `DELETE FROM oauth_client 
       WHERE client_id = $(client_id) AND user_id = $(user_id)`,
        { client_id: clientId, user_id: userId },
      );

      logger.info("Deleted OAuth client");

      res.status(204).send();
    } catch (error) {
      logger.error("Failed to delete OAuth client", {
        error: (error as Error).message,
        userId: req.user?.id,
        clientId: req.params.clientId,
      });

      res.status(500).json({
        error: {
          code: "DELETE_ERROR",
          message: "Failed to delete OAuth client",
        },
      });
    }
  },
);

export default router;
