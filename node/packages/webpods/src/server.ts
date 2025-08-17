/**
 * WebPods server factory
 */

import express, { Express } from 'express';
import session from 'express-session';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { createLogger } from './logger.js';
import { getSessionConfig } from './auth/session-store.js';
import { getConfig } from './config-loader.js';
import { getVersion } from './version.js';
import authRouter from './auth/routes.js';
import podsRouter from './routes/pods.js';

const logger = createLogger('webpods');

export function createApp(): Express {
  const app = express();
  const config = getConfig();
  const startTime = Date.now();

  // Security middleware
  app.use(helmet());
  app.use(cors({
    origin: config.server.corsOrigin?.split(',') || '*',
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
        originalUrl: req.originalUrl,
        path: req.path,
        hostname: req.hostname,
        status: res.statusCode,
        duration,
        ip: req.ip
      });
    });
    next();
  });

  // Health check endpoint (main domain only)
  app.get('/health', async (req, res) => {
    // Only allow health checks on main domain
    const subdomain = req.hostname.split('.')[0];
    const isMainDomain = subdomain === 'localhost' || 
                        subdomain === 'webpods' || 
                        subdomain === config.server.domain?.split('.')[0];
    
    if (!isMainDomain) {
      res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Health endpoint is only available on the main domain'
        }
      });
      return;
    }
    
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    
    // Check database connection
    let dbStatus = 'disconnected';
    try {
      const { getDb } = await import('./db.js');
      const db = getDb();
      await db.raw('SELECT 1');
      dbStatus = 'connected';
    } catch {
      dbStatus = 'disconnected';
    }
    
    res.json({
      status: 'healthy',
      uptime_seconds: uptime,
      uptime,
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      version: getVersion(),
      services: {
        database: dbStatus,
        cache: 'not_configured'
      }
    });
  });

  // Auth routes (main domain only, except /auth/callback which pods handle)
  app.use('/auth', (req, res, next) => {
    // Check if this is the main domain
    const subdomain = req.hostname.split('.')[0];
    const isMainDomain = subdomain === 'localhost' || 
                        subdomain === 'webpods' || 
                        subdomain === config.server.domain?.split('.')[0];
    
    if (isMainDomain) {
      // On main domain, use auth router
      authRouter(req, res, next);
    } else {
      // On subdomains, /auth/callback is handled by pod router
      // Skip this middleware and let it fall through
      if (req.path === '/callback') {
        next('route'); // Skip to next route handler
      } else {
        // Other /auth routes return 404 on subdomains
        res.status(404).json({
          error: {
            code: 'NOT_FOUND',
            message: 'Authentication endpoints are only available on the main domain'
          }
        });
      }
    }
  });

  // Pod routes (subdomain-based)
  app.use(podsRouter);

  // 404 handler
  app.use((req, res) => {
    const subdomain = req.hostname.split('.')[0];
    
    // If this is a subdomain, it's a pod not found error
    if (subdomain && subdomain !== 'localhost' && subdomain !== 'webpods') {
      res.status(404).json({
        error: {
          code: 'STREAM_NOT_FOUND',
          message: `Stream not found in pod '${subdomain}'`
        }
      });
    } else {
      res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Resource not found'
        }
      });
    }
  });

  // Error handler
  app.use((err: any, req: any, res: any, _next: any) => {
    logger.error('Unhandled error', {
      error: err.message,
      stack: err.stack,
      url: req.url,
      method: req.method
    });

    res.status(err.status || 500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: process.env.NODE_ENV === 'production' 
          ? 'An error occurred' 
          : err.message
      }
    });
  });

  return app;
}