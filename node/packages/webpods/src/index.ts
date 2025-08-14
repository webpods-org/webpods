/**
 * WebPods server entry point
 */

import { config } from 'dotenv';
import { createLogger } from './logger.js';
import { closeDb, checkDbConnection } from './db.js';
import { startStateCleanup } from './auth/pkce-store.js';
import { createApp } from './server.js';

// Load environment variables
config();

const logger = createLogger('webpods');

export async function start() {
  try {
    // Check required environment variables
    const required = ['JWT_SECRET'];
    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0 && process.env.NODE_ENV === 'production') {
      logger.error(`Missing required environment variables: ${missing.join(', ')}`);
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
    
    // Create app
    const app = createApp();
    const port = process.env.WEBPODS_PORT || process.env.PORT || 3000;
    
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

export { start as default };