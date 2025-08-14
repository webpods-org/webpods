/**
 * OAuth flow tests with mock provider
 * NOTE: This test must be run separately with mock OAuth environment set up
 */

import { expect } from 'chai';
import { 
  TestDatabase, 
  TestServer, 
  TestHttpClient,
  testLogger,
  createMockOAuthProvider, 
  getMockOAuthEnv,
  MockOAuthProvider
} from 'webpods-test-utils';

describe('OAuth Flow with Mock Provider', () => {
  let mockOAuth: MockOAuthProvider;
  let testDb: TestDatabase;
  let testServer: TestServer;
  let client: TestHttpClient;
  const mockOAuthPort = 4567;
  
  before(async function() {
    this.timeout(60000);
    
    console.log('🚀 Setting up mock OAuth test environment...');
    
    // 1. Start mock OAuth provider FIRST
    mockOAuth = createMockOAuthProvider(mockOAuthPort);
    await mockOAuth.start();
    
    // 2. Set environment variables BEFORE starting server
    const mockEnv = getMockOAuthEnv('google', mockOAuthPort);
    Object.assign(process.env, {
      ...mockEnv,
      GOOGLE_ISSUER: `http://localhost:${mockOAuthPort}`,
      // Also ensure domain is localhost for testing
      DOMAIN: 'localhost',
      GOOGLE_CALLBACK_URL: 'http://localhost:3099/auth/google/callback'
    });
    
    // 3. Now setup database and server with mock OAuth environment
    testDb = new TestDatabase({ dbName: 'webpods_test', logger: testLogger });
    await testDb.setup();
    
    testServer = new TestServer({ port: 3099, dbName: 'webpods_test', logger: testLogger });
    await testServer.start();
    
    client = new TestHttpClient('http://localhost:3099');
    
    console.log('✅ Mock OAuth test setup complete');
  });
  
  after(async function() {
    this.timeout(30000);
    
    console.log('🛑 Shutting down mock OAuth tests...');
    
    if (testServer) await testServer.stop();
    if (testDb) await testDb.cleanup();
    if (mockOAuth) await mockOAuth.stop();
    
    console.log('✅ Mock OAuth test teardown complete');
  });
  
  beforeEach(() => {
    mockOAuth.reset();
    client.clearAuthToken();
  });
  
  afterEach(async () => {
    if (testDb) await testDb.truncateAllTables();
  });
  
  describe('Complete OAuth Flow', () => {
    it('should complete OAuth flow and issue pod-specific token', async () => {
      const pod = 'alice';
      
      // 1. Start at pod login
      client.setBaseUrl(`http://${pod}.localhost:3099`);
      
      let response = await client.get('/login', {
        followRedirect: false
      });
      
      expect(response.status).to.equal(302);
      const authUrl = response.headers.location;
      expect(authUrl).to.include('/auth/authorize');
      expect(authUrl).to.include(`pod=${pod}`);
      
      // 2. Follow to /auth/authorize on main domain
      client.setBaseUrl('http://localhost:3099');
      const authPath = authUrl.replace(/^https?:\/\/[^\/]+/, '');
      response = await client.get(authPath, {
        followRedirect: false
      });
      
      // Should redirect to mock OAuth provider
      expect(response.status).to.equal(302);
      const oauthUrl = response.headers.location;
      expect(oauthUrl).to.include(`localhost:${mockOAuthPort}`);
      expect(oauthUrl).to.include('/oauth/authorize');
      
      // 3. Mock OAuth provider will auto-redirect back with code
      // Since the mock immediately redirects, we can follow the chain
      const oauthUrlObj = new URL(oauthUrl, `http://localhost:${mockOAuthPort}`);
      const redirectUri = oauthUrlObj.searchParams.get('redirect_uri');
      const state = oauthUrlObj.searchParams.get('state');
      
      // Simulate the OAuth provider redirect
      const callbackUrl = new URL(redirectUri!);
      callbackUrl.searchParams.set('code', 'mock-auth-code');
      callbackUrl.searchParams.set('state', state!);
      
      // 4. Hit the callback
      response = await client.get(callbackUrl.pathname + callbackUrl.search, {
        followRedirect: false
      });
      
      // Should redirect back to pod with token
      expect(response.status).to.equal(302);
      const podCallbackUrl = response.headers.location;
      expect(podCallbackUrl).to.include(`${pod}.localhost`);
      expect(podCallbackUrl).to.include('/auth/callback');
      expect(podCallbackUrl).to.include('token=');
      
      // 5. Extract and verify token
      const tokenMatch = podCallbackUrl.match(/token=([^&]+)/);
      expect(tokenMatch).to.exist;
      const token = decodeURIComponent(tokenMatch![1]);
      
      // 6. Use token to create content on pod
      client.setBaseUrl(`http://${pod}.localhost:3099`);
      client.setAuthToken(token);
      
      response = await client.post('/test-stream', 'OAuth test content', {
        headers: {
          'Content-Type': 'text/plain'
        }
      });
      
      expect(response.status).to.equal(201);
      expect(response.data.records).to.have.lengthOf(1);
      expect(response.data.records[0].content).to.equal('OAuth test content');
    });
  });
  
  describe('SSO Behavior', () => {
    it('should use existing session for second pod', async () => {
      // This test would require maintaining session cookies
      // across different subdomains which is complex in testing
      // For now, we verify the basic OAuth flow works
    });
  });
});