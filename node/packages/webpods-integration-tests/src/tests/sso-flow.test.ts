/**
 * SSO (Single Sign-On) flow tests using mock OAuth provider
 */

import { expect } from 'chai';
import { 
  createMockOAuthProvider, 
  getMockOAuthEnv,
  MockOAuthProvider,
  TestHttpClient 
} from 'webpods-test-utils';
import { testDb, testServer } from '../test-setup.js';

describe.skip('SSO Flow with Mock OAuth', () => {
  // Skip these tests for now - they require server restart with mock OAuth environment
  // To properly test OAuth flow, we need to:
  // 1. Set mock OAuth environment variables BEFORE server starts
  // 2. Clear OAuth client cache or restart server
  // This would require modifying the test setup to support dynamic server restart
  
  let mockOAuth: MockOAuthProvider;
  let client: TestHttpClient;
  const mockOAuthPort = 4567; // Use different port to avoid conflicts
  
  before(async () => {
    // Start mock OAuth provider
    mockOAuth = createMockOAuthProvider(mockOAuthPort);
    await mockOAuth.start();
    
    // Override OAuth environment variables to use mock
    const mockEnv = getMockOAuthEnv('google', mockOAuthPort);
    Object.assign(process.env, mockEnv);
    
    // Also need to update the provider URLs in the running server
    // This is a bit hacky but necessary for testing
    process.env.GOOGLE_ISSUER = `http://localhost:${mockOAuthPort}`;
    
    console.log('Mock OAuth provider started on port', mockOAuthPort);
  });
  
  after(async () => {
    // Stop mock OAuth provider
    await mockOAuth.stop();
  });
  
  beforeEach(() => {
    // Reset mock OAuth state
    mockOAuth.reset();
    
    // Create new client for each test
    client = new TestHttpClient('http://localhost:3099');
  });
  
  describe('First Pod Login (Full OAuth Flow)', () => {
    it('should complete OAuth flow and create session', async () => {
      // Start at alice.localhost/login
      client.setBaseUrl('http://alice.localhost:3099');
      
      // 1. Initiate login - should redirect to main domain
      let response = await client.get('/login', {
        followRedirect: false
      });
      
      expect(response.status).to.equal(302);
      const authUrl = response.headers.location;
      expect(authUrl).to.include('/auth/authorize');
      expect(authUrl).to.include('pod=alice');
      
      // 2. Follow to /auth/authorize on main domain
      client.setBaseUrl('http://localhost:3099');
      response = await client.get(authUrl.replace('https://webpods.org', ''), {
        followRedirect: false
      });
      
      // Should redirect to mock OAuth provider
      expect(response.status).to.equal(302);
      const oauthUrl = response.headers.location;
      expect(oauthUrl).to.include(`localhost:${mockOAuthPort}`);
      expect(oauthUrl).to.include('/oauth/authorize');
      
      // 3. Mock OAuth provider will redirect back with code
      // Extract the redirect_uri and state from OAuth URL
      const oauthUrlObj = new URL(oauthUrl, `http://localhost:${mockOAuthPort}`);
      const redirectUri = oauthUrlObj.searchParams.get('redirect_uri');
      const state = oauthUrlObj.searchParams.get('state');
      
      // Simulate OAuth provider redirect back
      const callbackUrl = new URL(redirectUri!);
      callbackUrl.searchParams.set('code', 'mock-code-123');
      callbackUrl.searchParams.set('state', state!);
      
      // 4. Hit the callback with the code
      response = await client.get(callbackUrl.pathname + callbackUrl.search, {
        followRedirect: false,
        headers: {
          Cookie: response.headers['set-cookie']?.[0] || ''
        }
      });
      
      // Should redirect back to pod with token
      expect(response.status).to.equal(302);
      const podCallbackUrl = response.headers.location;
      expect(podCallbackUrl).to.include('alice.localhost');
      expect(podCallbackUrl).to.include('/auth/callback');
      expect(podCallbackUrl).to.include('token=');
      
      // Extract token from URL
      const tokenMatch = podCallbackUrl.match(/token=([^&]+)/);
      expect(tokenMatch).to.exist;
      const token = decodeURIComponent(tokenMatch![1]);
      
      // 5. Verify the token works on alice's pod
      client.setBaseUrl('http://alice.localhost:3099');
      response = await client.post('/test-stream', 'Test content', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'text/plain'
        }
      });
      
      expect(response.status).to.equal(201);
      
      // 6. Verify session was created (check session cookie exists)
      expect(response.headers['set-cookie']).to.exist;
    });
  });
  
  describe('Second Pod Login (SSO - No OAuth)', () => {
    it('should skip OAuth for second pod when session exists', async () => {
      // This test would need to maintain cookies across requests
      // Using a proper HTTP agent that maintains cookie jar
      
      // First, complete a full OAuth login for alice
      // (Similar to above test but maintain cookies)
      
      // Then visit bob.localhost/login
      // Should get token immediately without OAuth redirect
      
      // Note: This test is complex because it requires maintaining
      // session cookies across different domains (localhost vs alice.localhost)
      // In a real implementation, we'd need to:
      // 1. Use a cookie jar that handles subdomains
      // 2. Or manually extract and pass session cookies
    });
  });
  
  describe('OAuth Provider Failures', () => {
    it('should handle OAuth provider errors gracefully', async () => {
      // Stop the mock OAuth provider to simulate failure
      await mockOAuth.stop();
      
      client.setBaseUrl('http://alice.localhost:3099');
      
      // Try to login - should eventually fail gracefully
      const response = await client.get('/login', {
        followRedirect: false
      }).catch(err => ({ status: 500, data: { error: err.message } }));
      
      expect(response.status).to.be.oneOf([500, 502, 503]);
      
      // Restart for other tests
      await mockOAuth.start();
    });
  });
  
  describe('Token Scoping with OAuth Flow', () => {
    it('should issue pod-specific token after OAuth', async () => {
      // Complete OAuth flow for alice.localhost
      // Verify the issued token has pod: "alice" claim
      // Verify it works on alice but not on bob
      
      // This combines OAuth flow with pod isolation testing
    });
  });
  
  describe('Session Expiry', () => {
    it('should require re-authentication after session expires', async () => {
      // Complete OAuth flow
      // Manually expire or delete session
      // Try to access second pod
      // Should redirect to OAuth again
    });
  });
});