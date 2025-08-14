/**
 * WebPods server entry point
 */

import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { config } from 'dotenv';
import { createLogger } from './logger.js';
import { closeDb, checkDbConnection } from './db.js';
import { getSessionConfig } from './auth/session-store.js';
import { startStateCleanup } from './auth/pkce-store.js';
import authRouter from './auth/routes.js';
import podsRouter from './routes/pods.js';

// Load environment variables
config();

const logger = createLogger('webpods');
const app = express();
const port = process.env.WEBPODS_PORT || process.env.PORT || 3000;
const startTime = Date.now();

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN?.split(',') || '*',
  credentials: true
}));

// Request parsing
app.use(express.json({ limit: '1mb' }));
app.use(express.text({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(compression());
app.use(cookieParser());

// Session management for SSO (works on all domains but only used for auth)
const sessionMiddleware = session(getSessionConfig());
app.use(sessionMiddleware);

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info('Request completed', {
      method: req.method,
      url: req.url,
      hostname: req.hostname,
      status: res.statusCode,
      duration,
      ip: req.ip
    });
  });
  next();
});

// Helper to check if hostname is main domain
function isMainDomain(hostname: string): boolean {
  const domain = process.env.DOMAIN || 'webpods.org';
  // Check for exact match or localhost (with any port)
  return hostname === domain || 
         hostname === 'localhost' || 
         hostname.startsWith('localhost:') ||
         hostname === `localhost:${port}`;
}

// Health check (on main domain only)
app.get('/health', async (req, res) => {
  const hostname = req.hostname || req.headers.host?.split(':')[0] || '';
  
  // Only serve health check on main domain
  if (!isMainDomain(hostname)) {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'Health check only available on main domain'
      }
    });
    return;
  }
  
  const services: Record<string, string> = {};
  
  // Check database connection
  const dbConnected = await checkDbConnection();
  services.database = dbConnected ? 'connected' : 'disconnected';
  
  res.json({
    status: dbConnected ? 'healthy' : 'degraded',
    version: process.env.npm_package_version || '0.0.1',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    services
  });
});

// Auth routes on main domain only
app.use('/auth', (req, res, next) => {
  const hostname = req.hostname || req.headers.host?.split(':')[0] || '';
  if (isMainDomain(hostname)) {
    authRouter(req, res, next);
  } else {
    next();
  }
});

// Route based on hostname for pod operations
app.use((req, res, next) => {
  const hostname = req.hostname || req.headers.host?.split(':')[0] || '';
  
  // Skip main domain (already handled auth above)
  if (isMainDomain(hostname)) {
    return next();
  }
  
  // All other hostnames (subdomains) go to pod router
  podsRouter(req, res, next);
});

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ 
    error: {
      code: 'NOT_FOUND',
      message: 'Endpoint not found'
    }
  });
});

// Error handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Unhandled error', { error: err });
  
  // Handle JSON parsing errors
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({ 
      error: {
        code: 'INVALID_JSON',
        message: 'Invalid JSON in request body'
      }
    });
    return;
  }
  
  // Generic error response
  res.status(500).json({ 
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Internal server error'
    }
  });
});

// Start server
async function start() {
  try {
    // Check required environment variables
    const required = ['JWT_SECRET'];
    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
      logger.error('Missing required environment variables', { missing });
      process.exit(1);
    }
    
    // Check OAuth configuration
    if (!process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_CLIENT_SECRET) {
      logger.warn('GitHub OAuth not configured');
    }
    
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      logger.warn('Google OAuth not configured');
    }
    
    if ((!process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_CLIENT_SECRET) &&
        (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET)) {
      logger.error('At least one OAuth provider must be configured');
      process.exit(1);
    }
    
    // Test database connection
    const dbConnected = await checkDbConnection();
    if (!dbConnected) {
      logger.error('Failed to connect to database');
      process.exit(1);
    }
    
    // Start PKCE state cleanup
    startStateCleanup();
    
    const server = app.listen(port, () => {
      logger.info(`WebPods server started`, {
        port,
        environment: process.env.NODE_ENV || 'development',
        cors: process.env.CORS_ORIGIN || '*',
        domain: process.env.DOMAIN || 'webpods.org'
      });
    });
    
    // Graceful shutdown
    process.on('SIGTERM', async () => {
      logger.info('SIGTERM received, shutting down gracefully');
      server.close(async () => {
        await closeDb();
        process.exit(0);
      });
    });
    
    process.on('SIGINT', async () => {
      logger.info('SIGINT received, shutting down gracefully');
      server.close(async () => {
        await closeDb();
        process.exit(0);
      });
    });
  } catch (error) {
    logger.error('Failed to start server', { error });
    process.exit(1);
  }
}

// Start if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  start();
}

export { app, start };