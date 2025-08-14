/**
 * Mock OAuth provider for testing OAuth flows
 */

import express, { Express } from 'express';
import { Server } from 'http';
import jwt from 'jsonwebtoken';

export interface MockUser {
  id: string;
  email: string;
  name: string;
  provider: 'google' | 'github';
}

export interface MockOAuthProvider {
  app: Express;
  server: Server;
  port: number;
  users: Map<string, MockUser>;
  authCodes: Map<string, { user: MockUser; state: string; used: boolean }>;
  accessTokens: Map<string, MockUser>;
  start(): Promise<void>;
  stop(): Promise<void>;
  addUser(user: MockUser): void;
  reset(): void;
}

/**
 * Creates a mock OAuth provider for testing
 */
export function createMockOAuthProvider(port: number = 4000): MockOAuthProvider {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  
  const users = new Map<string, MockUser>();
  const authCodes = new Map<string, { user: MockUser; state: string; used: boolean }>();
  const accessTokens = new Map<string, MockUser>();
  
  // Default test user
  const defaultUser: MockUser = {
    id: 'mock-user-123',
    email: 'test@example.com',
    name: 'Test User',
    provider: 'google'
  };
  users.set(defaultUser.email, defaultUser);
  
  // Mock authorization endpoint - immediately returns code
  app.get('/oauth/authorize', (req, res) => {
    const { 
      redirect_uri, 
      state
    } = req.query;
    // In real OAuth, we'd validate client_id, response_type, code_challenge, etc.
    // For testing, we just need redirect_uri and state
    
    if (!state || !redirect_uri) {
      res.status(400).json({ error: 'Missing required parameters' });
      return;
    }
    
    // Generate a fake authorization code
    const code = `mock-code-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Store the code with the default user (in real flow, user would select account)
    authCodes.set(code, {
      user: defaultUser,
      state: state as string,
      used: false
    });
    
    // Immediately redirect back with code (simulating user consent)
    const redirectUrl = new URL(redirect_uri as string);
    redirectUrl.searchParams.set('code', code);
    redirectUrl.searchParams.set('state', state as string);
    
    res.redirect(redirectUrl.toString());
  });
  
  // Mock token endpoint - exchanges code for tokens  
  app.post('/oauth/token', (req, res) => {
    const { code, grant_type } = req.body;
    // In real OAuth, we'd validate client_id, client_secret, redirect_uri, code_verifier
    // For testing, we just check the code
    
    if (grant_type !== 'authorization_code') {
      res.status(400).json({ error: 'Unsupported grant type' });
      return;
    }
    
    const authCode = authCodes.get(code);
    if (!authCode) {
      res.status(400).json({ error: 'Invalid authorization code' });
      return;
    }
    
    if (authCode.used) {
      res.status(400).json({ error: 'Authorization code already used' });
      return;
    }
    
    // Mark code as used
    authCode.used = true;
    
    // Generate access token
    const accessToken = `mock-access-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    accessTokens.set(accessToken, authCode.user);
    
    // Generate a proper JWT ID token
    const idToken = jwt.sign(
      {
        iss: `http://localhost:${port}`,
        sub: authCode.user.id,
        aud: 'mock-google-client-id', // Must match GOOGLE_CLIENT_ID
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        email: authCode.user.email,
        email_verified: true,
        name: authCode.user.name
      },
      'mock-jwt-secret',
      { algorithm: 'HS256' }
    );
    
    // Return tokens
    res.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: `mock-refresh-${Date.now()}`,
      scope: 'openid email profile',
      id_token: idToken
    });
  });
  
  // Mock userinfo endpoint - returns user data
  app.get('/oauth/userinfo', (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    
    const token = authHeader.substring(7);
    const user = accessTokens.get(token);
    
    if (!user) {
      res.status(401).json({ error: 'Invalid access token' });
      return;
    }
    
    // Return user info based on provider format
    if (user.provider === 'google') {
      res.json({
        sub: user.id,
        email: user.email,
        email_verified: true,
        name: user.name,
        given_name: user.name.split(' ')[0],
        family_name: user.name.split(' ')[1] || '',
        picture: `https://example.com/photo/${user.id}.jpg`,
        locale: 'en'
      });
    } else if (user.provider === 'github') {
      res.json({
        id: parseInt(user.id.replace(/\D/g, '')),
        login: user.email.split('@')[0],
        email: user.email,
        name: user.name,
        avatar_url: `https://github.com/${user.id}.png`,
        type: 'User'
      });
    }
  });
  
  // GitHub-specific user endpoint
  app.get('/user', (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    
    const token = authHeader.substring(7);
    const user = accessTokens.get(token);
    
    if (!user || user.provider !== 'github') {
      res.status(401).json({ error: 'Invalid access token' });
      return;
    }
    
    res.json({
      id: parseInt(user.id.replace(/\D/g, '')),
      login: user.email.split('@')[0],
      email: user.email,
      name: user.name,
      avatar_url: `https://github.com/${user.id}.png`,
      type: 'User'
    });
  });
  
  // Health check endpoint
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', type: 'mock-oauth-provider' });
  });
  
  let server: Server | null = null;
  
  return {
    app,
    server: server!,
    port,
    users,
    authCodes,
    accessTokens,
    
    async start() {
      return new Promise((resolve) => {
        server = app.listen(port, () => {
          this.server = server!;
          console.log(`Mock OAuth provider running on port ${port}`);
          resolve();
        });
      });
    },
    
    async stop() {
      return new Promise((resolve) => {
        if (server) {
          server.close(() => {
            console.log('Mock OAuth provider stopped');
            resolve();
          });
        } else {
          resolve();
        }
      });
    },
    
    addUser(user: MockUser) {
      users.set(user.email, user);
    },
    
    reset() {
      authCodes.clear();
      accessTokens.clear();
      // Keep default user
      users.clear();
      users.set(defaultUser.email, defaultUser);
    }
  };
}

/**
 * Environment variable overrides for using mock OAuth
 */
export function getMockOAuthEnv(provider: 'google' | 'github', port: number = 4000): Record<string, string> {
  const baseUrl = `http://localhost:${port}`;
  
  if (provider === 'google') {
    return {
      GOOGLE_AUTH_URL: `${baseUrl}/oauth/authorize`,
      GOOGLE_TOKEN_URL: `${baseUrl}/oauth/token`,
      GOOGLE_USERINFO_URL: `${baseUrl}/oauth/userinfo`,
      GOOGLE_CLIENT_ID: 'mock-google-client-id',
      GOOGLE_CLIENT_SECRET: 'mock-google-client-secret'
    };
  } else {
    return {
      GITHUB_AUTH_URL: `${baseUrl}/oauth/authorize`,
      GITHUB_TOKEN_URL: `${baseUrl}/oauth/token`,
      GITHUB_USER_URL: `${baseUrl}/user`,
      GITHUB_CLIENT_ID: 'mock-github-client-id',
      GITHUB_CLIENT_SECRET: 'mock-github-client-secret'
    };
  }
}