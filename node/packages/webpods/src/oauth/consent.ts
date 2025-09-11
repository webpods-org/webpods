/**
 * OAuth consent endpoint - handles pod permission grants
 */

import { Router, Request, Response } from "express";
import { getHydraAdmin } from "./hydra-client.js";
import { isTestModeAllowed } from "./test-mode-guard.js";
import { getDb } from "../db/index.js";
import { createLogger } from "../logger.js";
import { getConfig } from "../config-loader.js";

const logger = createLogger("webpods:oauth:consent");
const router = Router();

/**
 * Parse pods from consent request
 * Supports both legacy pod:alice scopes and new pods parameter
 * The state parameter from OAuth request is preserved through the flow
 */
function parseRequestedPods(
  _req: Request,
  consentRequest: unknown,
  scopes: string[],
): Set<string> {
  const pods = new Set<string>();

  // Check state from original OAuth request (preserved through the flow)
  // Try to get state from various possible locations
  const consent = consentRequest as Record<string, unknown>;
  const possibleState =
    (consent.state as string) ||
    (typeof consent.request_url === "string" &&
    consent.request_url.includes("state=")
      ? new URL(consent.request_url, "http://example.com").searchParams.get(
          "state",
        )
      : null);

  if (possibleState) {
    try {
      const stateData = JSON.parse(
        Buffer.from(possibleState, "base64").toString(),
      );
      if (stateData.pods && Array.isArray(stateData.pods)) {
        stateData.pods.forEach((pod: string) => {
          if (pod) pods.add(pod);
        });
      }
    } catch {
      // Invalid state format, ignore
    }
  }

  // Legacy support: pod:alice format in scopes
  for (const scope of scopes) {
    if (scope.startsWith("pod:")) {
      const podId = scope.substring(4);
      if (podId) {
        pods.add(podId);
      }
    }
  }

  return pods;
}

/**
 * Get pods owned by user
 */
async function getUserOwnedPods(userId: string): Promise<string[]> {
  const db = getDb();

  try {
    // Get all pods
    const pods = await db.manyOrNone<{ name: string }>(`SELECT name FROM pod`);

    const ownedPods: string[] = [];

    // Check ownership for each pod using simple queries
    for (const pod of pods) {
      // Get .config stream
      const configStream = await db.oneOrNone<{ id: string }>(
        `SELECT id FROM stream 
         WHERE pod_name = $(pod_name) 
           AND name = '.config' 
           AND parent_id IS NULL`,
        { pod_name: pod.name },
      );

      if (!configStream) continue;

      // Get owner stream (child of .config)
      const ownerStream = await db.oneOrNone<{ id: string }>(
        `SELECT id FROM stream 
         WHERE parent_id = $(parent_id) 
           AND name = 'owner'`,
        { parent_id: configStream.id },
      );

      if (!ownerStream) continue;

      // Get latest owner record
      const ownerRecord = await db.oneOrNone<{ content: string }>(
        `SELECT content FROM record 
         WHERE stream_id = $(stream_id)
           AND name = 'owner'
         ORDER BY index DESC
         LIMIT 1`,
        { stream_id: ownerStream.id },
      );

      if (ownerRecord) {
        try {
          const content = JSON.parse(ownerRecord.content);
          if (content.userId === userId) {
            ownedPods.push(pod.name);
          }
        } catch {
          // Invalid JSON, skip
        }
      }
    }

    return ownedPods;
  } catch (error) {
    logger.error("Failed to get user pods", { error, userId });
    return [];
  }
}

/**
 * Show consent page
 * GET /oauth/consent?consent_challenge=xxx
 */
router.get("/consent", async (req: Request, res: Response) => {
  const consentChallenge = req.query.consent_challenge as string;

  if (!consentChallenge) {
    res.status(400).json({
      error: {
        code: "MISSING_CHALLENGE",
        message: "consent_challenge parameter is required",
      },
    });
    return;
  }

  try {
    const hydraAdmin = getHydraAdmin();

    // Get consent request details
    const { data: consentRequest } = await hydraAdmin.getOAuth2ConsentRequest({
      consentChallenge,
    });

    // Test mode: auto-accept consent (only in controlled environments)
    if (req.headers["x-test-consent"]) {
      if (!isTestModeAllowed(req)) {
        // Test headers detected but not allowed
        res.status(403).json({
          error: {
            code: "FORBIDDEN",
            message: "Test mode is not enabled",
          },
        });
        return;
      }

      logger.info("Test mode: auto-accepting consent");

      const pods = Array.from(
        parseRequestedPods(
          req,
          consentRequest,
          consentRequest.requested_scope || [],
        ),
      );

      logger.info("Parsed pods:", {
        pods,
        fullConsentRequest: JSON.stringify(consentRequest),
      });

      // Generate audience URLs for each pod
      const audience = pods.map((pod) => `https://${pod}.webpods.com`);

      const config = getConfig();
      const rememberForSeconds = (config.oauth.rememberLongHours ?? 24) * 3600;
      const { data: acceptResponse } =
        await hydraAdmin.acceptOAuth2ConsentRequest({
          consentChallenge,
          acceptOAuth2ConsentRequest: {
            grant_scope: consentRequest.requested_scope,
            grant_access_token_audience: audience,
            session: {
              access_token: {
                ext: {
                  pods,
                },
              },
            },
            remember: true,
            remember_for: rememberForSeconds,
          },
        });

      res.redirect(acceptResponse.redirect_to!);
      return;
    }

    // Check if we should skip consent (user already granted)
    if (consentRequest.skip) {
      const pods = Array.from(
        parseRequestedPods(
          req,
          consentRequest,
          consentRequest.requested_scope || [],
        ),
      );

      // Generate audience URLs for each pod
      const audience = pods.map((pod) => `https://${pod}.webpods.com`);

      const { data: acceptResponse } =
        await hydraAdmin.acceptOAuth2ConsentRequest({
          consentChallenge,
          acceptOAuth2ConsentRequest: {
            grant_scope: consentRequest.requested_scope,
            grant_access_token_audience: audience,
            session: {
              access_token: {
                ext: {
                  pods,
                },
              },
            },
          },
        });

      logger.info("Consent skipped (previously granted)", {
        subject: consentRequest.subject,
        redirectTo: acceptResponse.redirect_to,
      });

      res.redirect(acceptResponse.redirect_to!);
      return;
    }

    // Parse requested pod permissions
    const requestedPods = parseRequestedPods(
      req,
      consentRequest,
      consentRequest.requested_scope || [],
    );

    // Get pods owned by the user
    const ownedPods = await getUserOwnedPods(consentRequest.subject!);

    // Filter to only pods the user owns
    const validPods = new Set<string>();
    for (const podId of requestedPods) {
      if (ownedPods.includes(podId)) {
        validPods.add(podId);
      }
    }

    // Render consent page
    const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Authorize Application - WebPods</title>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 500px;
      margin: 50px auto;
      padding: 20px;
      background: #f5f5f5;
    }
    .container {
      background: white;
      border-radius: 8px;
      padding: 30px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }
    h1 { color: #333; margin-bottom: 10px; font-size: 24px; }
    .client-name { 
      font-weight: bold; 
      color: #007bff;
      font-size: 18px;
      margin-bottom: 20px;
    }
    .scope-list {
      background: #f8f9fa;
      border: 1px solid #dee2e6;
      border-radius: 4px;
      padding: 15px;
      margin: 20px 0;
    }
    .scope-item {
      margin: 10px 0;
      padding: 8px;
      background: white;
      border-radius: 4px;
    }
    .pod-name { font-weight: bold; color: #28a745; }
    .permissions { color: #666; font-size: 14px; }
    .warning {
      background: #fff3cd;
      border: 1px solid #ffc107;
      border-radius: 4px;
      padding: 10px;
      margin: 15px 0;
      color: #856404;
    }
    .unavailable {
      background: #f8d7da;
      border: 1px solid #f5c6cb;
      color: #721c24;
    }
    .buttons {
      display: flex;
      gap: 10px;
      margin-top: 20px;
    }
    button {
      flex: 1;
      padding: 12px;
      border: none;
      border-radius: 4px;
      font-size: 16px;
      cursor: pointer;
      font-weight: 500;
    }
    .approve {
      background: #28a745;
      color: white;
    }
    .approve:hover { background: #218838; }
    .deny {
      background: #dc3545;
      color: white;
    }
    .deny:hover { background: #c82333; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Authorization Request</h1>
    <div class="client-name">${consentRequest.client?.client_name || consentRequest.client?.client_id}</div>
    <p>This application is requesting access to your WebPods data:</p>
    
    <div class="scope-list">
      <h3>Requested Permissions:</h3>
      ${Array.from(validPods)
        .map(
          (podId) => `
        <div class="scope-item">
          <span class="pod-name">Pod: ${podId}</span>
          <div class="permissions">
            Full access
          </div>
        </div>
      `,
        )
        .join("")}
      
      ${Array.from(requestedPods)
        .filter((podId) => !ownedPods.includes(podId))
        .map(
          (podId) => `
        <div class="scope-item unavailable">
          <span class="pod-name">Pod: ${podId}</span>
          <div class="permissions">
            ❌ You don't have access to this pod
          </div>
        </div>
      `,
        )
        .join("")}
    </div>
    
    ${
      validPods.size === 0
        ? `
      <div class="warning">
        ⚠️ You don't own any of the requested pods. No permissions can be granted.
      </div>
    `
        : ""
    }
    
    <form method="POST" action="/oauth/consent">
      <input type="hidden" name="challenge" value="${consentChallenge}">
      <input type="hidden" name="scopes" value="${Array.from(validPods)
        .map((pod) => `pod:${pod}`)
        .join(",")}">
      
      <div class="buttons">
        <button type="submit" name="action" value="accept" class="approve" 
                ${validPods.size === 0 ? "disabled" : ""}>
          Authorize
        </button>
        <button type="submit" name="action" value="deny" class="deny">
          Deny
        </button>
      </div>
    </form>
  </div>
</body>
</html>`;

    res.send(html);
  } catch (error: unknown) {
    logger.error("Consent handler error", {
      error: (error as Error).message,
      challenge: consentChallenge,
    });

    res.status(500).json({
      error: {
        code: "CONSENT_ERROR",
        message: "Failed to process consent request",
      },
    });
  }
});

/**
 * Handle consent decision
 * POST /oauth/consent
 */
router.post("/consent", async (req: Request, res: Response) => {
  const { challenge, action, scopes } = req.body;

  if (!challenge) {
    res.status(400).json({
      error: {
        code: "MISSING_CHALLENGE",
        message: "challenge parameter is required",
      },
    });
    return;
  }

  try {
    const hydraAdmin = getHydraAdmin();

    if (action === "accept" && scopes) {
      // Parse approved scopes
      const approvedScopes = scopes.split(",").filter((s: string) => s);
      // For POST consent, we need to parse from the approved scopes, not consentRequest
      const pods: string[] = [];
      for (const scope of approvedScopes) {
        if (scope.startsWith("pod:")) {
          const podId = scope.substring(4);
          if (podId) pods.push(podId);
        }
      }

      // Generate audience URLs for each pod
      const audience = pods.map((pod) => `https://${pod}.webpods.com`);

      // Accept consent
      const config = getConfig();
      const rememberForSeconds = (config.oauth.rememberLongHours ?? 24) * 3600;
      const { data: acceptResponse } =
        await hydraAdmin.acceptOAuth2ConsentRequest({
          consentChallenge: challenge,
          acceptOAuth2ConsentRequest: {
            grant_scope: approvedScopes.concat(["openid", "offline"]),
            grant_access_token_audience: audience,
            session: {
              access_token: {
                ext: {
                  pods,
                },
              },
              id_token: {
                ext: {
                  pods,
                },
              },
            },
            remember: true,
            remember_for: rememberForSeconds,
          },
        });

      logger.info("Consent accepted", {
        challenge,
        pods,
        redirectTo: acceptResponse.redirect_to,
      });

      res.redirect(acceptResponse.redirect_to!);
    } else {
      // Deny consent
      const { data: rejectResponse } =
        await hydraAdmin.rejectOAuth2ConsentRequest({
          consentChallenge: challenge,
          rejectOAuth2Request: {
            error: "access_denied",
            error_description: "User denied access",
          },
        });

      logger.info("Consent denied", {
        challenge,
        redirectTo: rejectResponse.redirect_to,
      });

      res.redirect(rejectResponse.redirect_to!);
    }
  } catch (error: unknown) {
    logger.error("Consent decision error", {
      error: (error as Error).message,
      challenge,
      action,
    });

    res.status(500).json({
      error: {
        code: "CONSENT_ERROR",
        message: "Failed to process consent decision",
      },
    });
  }
});

export default router;
