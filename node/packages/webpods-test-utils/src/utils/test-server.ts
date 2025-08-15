// Test server utilities
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { Logger, consoleLogger } from './test-logger.js';
import { createMockOAuthProvider, MockOAuthProvider } from './mock-oauth-provider.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface TestServerConfig {
  port?: number;
  dbName?: string;
  logger?: Logger;
  useMockOAuth?: boolean;
  mockOAuthPort?: number;
}

export class TestServer {
  private process: ChildProcess | null = null;
  private config: TestServerConfig;
  private logger: Logger;
  private mockOAuth: MockOAuthProvider | null = null;

  constructor(config: TestServerConfig = {}) {
    this.config = {
      port: config.port || 3099,
      dbName: config.dbName || 'webpods_test',
      logger: config.logger,
      useMockOAuth: config.useMockOAuth !== false, // Default to true for tests
      mockOAuthPort: config.mockOAuthPort || 4567
    };
    this.logger = config.logger || consoleLogger;
  }

  public async start(): Promise<void> {
    this.logger.info(`🚀 Starting WebPods test server on port ${this.config.port}...`);

    // Start mock OAuth provider first if enabled
    if (this.config.useMockOAuth) {
      this.logger.info(`🔐 Starting mock OAuth provider on port ${this.config.mockOAuthPort}...`);
      this.mockOAuth = createMockOAuthProvider(this.config.mockOAuthPort!);
      await this.mockOAuth.start();
      this.logger.info('✅ Mock OAuth provider started');
    }

    const serverPath = path.join(__dirname, '../../../webpods/dist/index.js');
    
    // Path to test config file
    const testConfigPath = path.join(__dirname, '../../../webpods-integration-tests/test-config.json');
    
    // Set environment variables (minimal now, config is in JSON)
    const env: any = {
      ...process.env,
      NODE_ENV: 'test',
      WEBPODS_CONFIG_PATH: testConfigPath,
      WEBPODS_PORT: String(this.config.port),
      WEBPODS_DB_NAME: this.config.dbName,
      WEBPODS_DB_HOST: process.env.WEBPODS_DB_HOST || 'localhost',
      WEBPODS_DB_PORT: process.env.WEBPODS_DB_PORT || '5432',
      WEBPODS_DB_USER: process.env.WEBPODS_DB_USER || 'postgres',
      WEBPODS_DB_PASSWORD: process.env.WEBPODS_DB_PASSWORD || 'postgres',
      JWT_SECRET: 'test-secret-key',
      SESSION_SECRET: 'test-session-secret',
      LOG_LEVEL: 'info',
      PORT: String(this.config.port),
      DOMAIN: 'localhost', // Use localhost for testing
    };

    return new Promise((resolve, reject) => {
      this.process = spawn('node', [serverPath], {
        env,
        stdio: 'pipe'
      });

      this.process.stdout?.on('data', (data) => {
        const message = data.toString();
        // Always log server output for debugging
        console.log('[Server]', message.trim());
        if (message.includes('WebPods server started') || message.includes('Server listening')) {
          this.logger.info('✅ Test server started successfully');
          resolve();
        }
      });

      this.process.stderr?.on('data', (data) => {
        const message = data.toString();
        // Always log server errors for debugging
        console.error('[Server Error]', message.trim());
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

    // Stop mock OAuth provider if it was started
    if (this.mockOAuth) {
      this.logger.info('🛑 Stopping mock OAuth provider...');
      await this.mockOAuth.stop();
      this.mockOAuth = null;
      this.logger.info('✅ Mock OAuth provider stopped');
    }
  }

  public getMockOAuth(): MockOAuthProvider | null {
    return this.mockOAuth;
  }
}