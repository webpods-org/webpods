// Test server utilities
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { Logger, consoleLogger } from './test-logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface TestServerConfig {
  port?: number;
  dbName?: string;
  logger?: Logger;
}

export class TestServer {
  private process: ChildProcess | null = null;
  private config: TestServerConfig;
  private logger: Logger;

  constructor(config: TestServerConfig = {}) {
    this.config = {
      port: config.port || 3099,
      dbName: config.dbName || 'webpods_test',
      logger: config.logger
    };
    this.logger = config.logger || consoleLogger;
  }

  public async start(): Promise<void> {
    this.logger.info(`🚀 Starting WebPods test server on port ${this.config.port}...`);

    const serverPath = path.join(__dirname, '../../../webpods/dist/index.js');
    
    // Set environment variables
    const env = {
      ...process.env,
      NODE_ENV: 'test',
      WEBPODS_PORT: String(this.config.port),
      WEBPODS_DB_NAME: this.config.dbName,
      WEBPODS_DB_HOST: process.env.WEBPODS_DB_HOST || 'localhost',
      WEBPODS_DB_PORT: process.env.WEBPODS_DB_PORT || '5432',
      WEBPODS_DB_USER: process.env.WEBPODS_DB_USER || 'postgres',
      WEBPODS_DB_PASSWORD: process.env.WEBPODS_DB_PASSWORD || 'postgres',
      JWT_SECRET: 'test-secret-key',
      LOG_LEVEL: 'info',
      GOOGLE_CLIENT_ID: 'test-google-client-id',
      GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
      GOOGLE_CALLBACK_URL: `http://localhost:${this.config.port}/auth/google/callback`,
      GITHUB_CLIENT_ID: 'test-github-client-id',
      GITHUB_CLIENT_SECRET: 'test-github-client-secret',
      GITHUB_CALLBACK_URL: `http://localhost:${this.config.port}/auth/github/callback`
    };

    return new Promise((resolve, reject) => {
      this.process = spawn('node', [serverPath], {
        env,
        stdio: 'pipe'
      });

      this.process.stdout?.on('data', (data) => {
        const message = data.toString();
        this.logger.info('Server stdout:', message);
        if (message.includes('WebPods server started') || message.includes('Server listening')) {
          this.logger.info('✅ Test server started successfully');
          resolve();
        }
      });

      this.process.stderr?.on('data', (data) => {
        const message = data.toString();
        this.logger.error('Server stderr:', message);
        // Sometimes the server logs to stderr
        if (message.includes('WebPods server started') || message.includes('Server listening')) {
          this.logger.info('✅ Test server started successfully');
          resolve();
        }
      });

      this.process.on('error', (err) => {
        this.logger.error('Failed to start test server', { error: err });
        reject(err);
      });

      this.process.on('exit', (code) => {
        if (code !== 0 && code !== null) {
          this.logger.error(`Test server exited with code ${code}`);
        }
      });

      // Timeout after 10 seconds
      setTimeout(() => {
        if (!this.process?.killed) {
          reject(new Error('Server failed to start within 10 seconds'));
        }
      }, 10000);
    });
  }

  public async stop(): Promise<void> {
    if (this.process && !this.process.killed) {
      this.logger.info('🛑 Stopping test server...');
      this.process.kill('SIGTERM');
      
      // Wait for process to exit
      await new Promise((resolve) => {
        if (this.process) {
          this.process.on('exit', resolve);
          setTimeout(resolve, 2000); // Timeout after 2 seconds
        } else {
          resolve(undefined);
        }
      });
      
      this.process = null;
      this.logger.info('✅ Test server stopped');
    }
  }
}