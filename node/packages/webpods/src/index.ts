// WebPods server entry point
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import passport from 'passport';
import { config } from 'dotenv';
import { createLogger } from './logger.js';
import { closeDb, checkDbConnection } from './db.js';
import { queuesRouter } from './routes/queues.js';
import { authRouter } from './routes/auth.js';

// Load environment variables
config();

const logger = createLogger('webpods');
const app = express();
const port = process.env.WEBPODS_PORT || process.env.PORT || 3000;

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

// Passport initialization
app.use(passport.initialize());

// Global rate limiting (disabled in test mode)
if (process.env.NODE_ENV !== 'test') {
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // limit each IP to 1000 requests per windowMs
    message: 'Too many requests from this IP, please try again later.'
  });
  app.use(limiter);
}

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info('Request completed', {
      method: req.method,
      url: req.url,
      status: res.statusCode,
      duration,
      ip: req.ip
    });
  });
  next();
});

// Health check
app.get('/health', async (_req, res) => {
  const services: Record<string, string> = {};
  
  // Check database connection
  const dbConnected = await checkDbConnection();
  services.database = dbConnected ? 'connected' : 'disconnected';
  
  res.json({
    status: dbConnected ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    services
  });
});

// API routes
app.use('/', authRouter);
app.use('/', queuesRouter);

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
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      logger.warn('Google OAuth not configured - authentication will not work');
    }
    
    // Test database connection
    const dbConnected = await checkDbConnection();
    if (!dbConnected) {
      logger.error('Failed to connect to database');
      process.exit(1);
    }
    
    const server = app.listen(port, () => {
      logger.info(`WebPods server started`, {
        port,
        environment: process.env.NODE_ENV || 'development',
        cors: process.env.CORS_ORIGIN || '*'
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