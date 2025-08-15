// Test server utilities
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { Logger, consoleLogger } from './test-logger.js';
import { createMockOAuthProvider, getMockOAuthEnv, MockOAuthProvider } from './mock-oauth-provider.js';

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
    // Start mock OAuth provider first if enabled
    if (this.config.useMockOAuth) {
      this.mockOAuth = createMockOAuthProvider(this.config.mockOAuthPort!);
      await this.mockOAuth.start();
    }

    const serverPath = path.join(__dirname, '../../../webpods/dist/index.js');
    
    // Set environment variables
    let env: any = {
      ...process.env,
      NODE_ENV: 'test',
      WEBPODS_PORT: String(this.config.port),
      WEBPODS_DB_NAME: this.config.dbName,
      WEBPODS_DB_HOST: process.env.WEBPODS_DB_HOST || 'localhost',
      WEBPODS_DB_PORT: process.env.WEBPODS_DB_PORT || '5432',
      WEBPODS_DB_USER: process.env.WEBPODS_DB_USER || 'postgres',
      WEBPODS_DB_PASSWORD: process.env.WEBPODS_DB_PASSWORD || 'postgres',
      JWT_SECRET: 'test-secret-key',
      LOG_LEVEL: process.env.LOG_LEVEL || 'info', // Set to info so server starts properly
      DOMAIN: 'localhost', // Use localhost for testing
      GOOGLE_CLIENT_ID: 'test-google-client-id',
      GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
      GOOGLE_CALLBACK_URL: `http://localhost:${this.config.port}/auth/google/callback`,
      GITHUB_CLIENT_ID: 'test-github-client-id',
      GITHUB_CLIENT_SECRET: 'test-github-client-secret',
      GITHUB_CALLBACK_URL: `http://localhost:${this.config.port}/auth/github/callback`
    };

    // Add mock OAuth URLs if enabled
    if (this.config.useMockOAuth) {
      const mockGoogleEnv = getMockOAuthEnv('google', this.config.mockOAuthPort!);
      const mockGithubEnv = getMockOAuthEnv('github', this.config.mockOAuthPort!);
      env = {
        ...env,
        ...mockGoogleEnv,
        ...mockGithubEnv,
        GOOGLE_ISSUER: `http://localhost:${this.config.mockOAuthPort}`,
        GITHUB_ISSUER: `http://localhost:${this.config.mockOAuthPort}`
      };
    }

    return new Promise((resolve, reject) => {
      this.process = spawn('node', [serverPath], {
        env,
        stdio: 'pipe'
      });

      this.process.stdout?.on('data', (data) => {
        const message = data.toString();
        // Only log server output when LOG_LEVEL is debug
        if (process.env.LOG_LEVEL === 'debug') {
          console.log('[Server]', message.trim());
        }
        if (message.includes('WebPods server started') || message.includes('Server listening')) {
          resolve();
        }
      });

      this.process.stderr?.on('data', (data) => {
        const message = data.toString();
        // Only log server errors when LOG_LEVEL is debug
        if (process.env.LOG_LEVEL === 'debug') {
          console.error('[Server Error]', message.trim());
        }
        // Sometimes the server logs to stderr
        if (message.includes('WebPods server started') || message.includes('Server listening')) {
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
    }

    // Stop mock OAuth provider if it was started
    if (this.mockOAuth) {
      await this.mockOAuth.stop();
      this.mockOAuth = null;
    }
  }

  public getMockOAuth(): MockOAuthProvider | null {
    return this.mockOAuth;
  }
}