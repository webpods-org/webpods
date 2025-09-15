/**
 * Login page for WebPods
 */

import { Router, Request, Response } from "express";
import { getConfiguredProviders } from "./oauth-config.js";
import { createLogger } from "../logger.js";
import { rateLimit } from "../middleware/ratelimit.js";

const logger = createLogger("webpods:auth:login");
const router = Router();

/**
 * Login page with OAuth provider links
 * GET /login
 */
router.get("/login", rateLimit("read"), (req: Request, res: Response) => {
  const providers = getConfiguredProviders();
  const redirect = (req.query.redirect as string) || "/";

  // Generate provider links with redirect parameter
  const providerLinks = providers.map((id) => ({
    id,
    name: id.charAt(0).toUpperCase() + id.slice(1),
    url: `/auth/${id}?redirect=${encodeURIComponent(redirect)}`,
  }));

  logger.debug("Serving login page", {
    providers: providers.length,
    redirect,
  });

  // Return simple HTML login page
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Login - WebPods</title>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
        }
        
        .container {
          background: white;
          border-radius: 12px;
          padding: 40px;
          box-shadow: 0 20px 60px rgba(0,0,0,0.3);
          max-width: 400px;
          width: 100%;
        }
        
        h1 {
          color: #333;
          margin-bottom: 10px;
          font-size: 28px;
          text-align: center;
        }
        
        .subtitle {
          color: #666;
          text-align: center;
          margin-bottom: 30px;
          font-size: 14px;
        }
        
        .providers {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        
        .provider-button {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 12px 20px;
          border: 2px solid #e1e4e8;
          border-radius: 8px;
          text-decoration: none;
          color: #333;
          font-weight: 500;
          transition: all 0.3s ease;
          background: white;
        }
        
        .provider-button:hover {
          border-color: #667eea;
          background: #f8f9ff;
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(102, 126, 234, 0.2);
        }
        
        .provider-button.github {
          border-color: #24292e;
        }
        
        .provider-button.github:hover {
          background: #24292e;
          color: white;
        }
        
        .provider-button.google {
          border-color: #4285f4;
        }
        
        .provider-button.google:hover {
          background: #4285f4;
          color: white;
        }
        
        .provider-icon {
          width: 20px;
          height: 20px;
          margin-right: 10px;
        }
        
        .divider {
          text-align: center;
          color: #999;
          margin: 30px 0 20px;
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 1px;
        }
        
        .info {
          background: #f8f9fa;
          border-radius: 6px;
          padding: 15px;
          margin-top: 20px;
          font-size: 13px;
          color: #666;
          line-height: 1.5;
        }
        
        .info strong {
          color: #333;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>Welcome to WebPods</h1>
        <p class="subtitle">Sign in to access your pods and API</p>
        
        <div class="providers">
          ${providerLinks
            .map(
              (provider) => `
            <a href="${provider.url}" class="provider-button ${provider.id}">
              ${getProviderIcon(provider.id)}
              Continue with ${provider.name}
            </a>
          `,
            )
            .join("")}
        </div>
        
        <div class="divider">What you'll get</div>
        
        <div class="info">
          <strong>🔑 API Token</strong> - For CLI and programmatic access<br>
          <strong>🌐 SSO</strong> - Single sign-on across all pods<br>
          <strong>🚀 Pod Creation</strong> - Create and manage your pods<br>
          <strong>🔧 OAuth Clients</strong> - Register apps to access WebPods
        </div>
      </div>
    </body>
    </html>
  `);
});

/**
 * Get SVG icon for provider
 */
function getProviderIcon(provider: string): string {
  switch (provider) {
    case "github":
      return `<svg class="provider-icon" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
      </svg>`;
    case "google":
      return `<svg class="provider-icon" viewBox="0 0 24 24">
        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
      </svg>`;
    default:
      return `<svg class="provider-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M13.8 12H3"/>
      </svg>`;
  }
}

export default router;
