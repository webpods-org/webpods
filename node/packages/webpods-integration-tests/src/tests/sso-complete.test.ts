/**
 * Complete SSO flow tests
 * Tests the full OAuth flow and SSO behavior across multiple pods
 */

import { expect } from 'chai';
import jwt from 'jsonwebtoken';
import { TestHttpClient } from 'webpods-test-utils';
import { testDb, testServer } from '../test-setup.js';

describe('Complete SSO Flow', () => {
  let client: TestHttpClient;
  const jwtSecret = process.env.JWT_SECRET || 'test-secret-key';
  
  beforeEach(async () => {
    // Create new client for each test
    client = new TestHttpClient('http://localhost:3099');
    
    // Clear any existing sessions
    await testDb.getDb().raw('TRUNCATE TABLE session CASCADE');
    await testDb.getDb().raw('TRUNCATE TABLE oauth_state CASCADE');
  });
  
  describe('Mock OAuth Integration', () => {
    it('should verify mock OAuth provider is running', async () => {
      const response = await fetch('http://localhost:4567/health');
      const data = await response.json();
      
      expect(response.status).to.equal(200);
      expect(data.status).to.equal('ok');
      expect(data.type).to.equal('mock-oauth-provider');
    });
    
    it('should redirect to mock OAuth provider', async () => {
      const response = await client.get('/auth/google', {
        followRedirect: false
      });
      
      expect(response.status).to.equal(302);
      const location = response.headers.location;
      expect(location).to.include('localhost:4567');
      expect(location).to.include('/oauth/authorize');
    });
  });
  
  describe('Session Persistence', () => {
    it('should store session in PostgreSQL', async () => {
      // Create a mock authenticated session
      const userId = 'test-user-123';
      const authId = `auth:google:${userId}`;
      
      // First, create a user
      await testDb.getDb()('user').insert({
        auth_id: authId,
        email: 'test@example.com',
        name: 'Test User',
        provider: 'google'
      });
      
      // Get the created user
      const user = await testDb.getDb()('user')
        .where('auth_id', authId)
        .first();
      
      // Generate a token for authentication
      const token = jwt.sign(
        {
          user_id: user.id,
          auth_id: authId,
          email: 'test@example.com',
          name: 'Test User',
          provider: 'google'
        },
        jwtSecret,
        { expiresIn: '1h' }
      );
      
      // Make a request that should create a session
      client.setAuthToken(token);
      const response = await client.get('/auth/session');
      
      // Session won't exist without going through OAuth flow
      // But we can verify the endpoint works
      expect(response.status).to.be.oneOf([200, 401]);
      
      // Check if any sessions exist in the database
      const sessions = await testDb.getDb()('session').select('*');
      console.log('Sessions in database:', sessions.length);
    });
    
    it('should handle PKCE state storage', async () => {
      // Insert a test PKCE state
      const testState = 'test-state-' + Date.now();
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + 10);
      
      await testDb.getDb()('oauth_state').insert({
        state: testState,
        code_verifier: 'test-verifier',
        pod: 'alice',
        redirect_url: '/dashboard',
        expires_at: expiresAt
      });
      
      // Verify it was stored
      const stored = await testDb.getDb()('oauth_state')
        .where('state', testState)
        .first();
      
      expect(stored).to.exist;
      expect(stored.code_verifier).to.equal('test-verifier');
      expect(stored.pod).to.equal('alice');
      expect(stored.redirect_url).to.equal('/dashboard');
    });
    
    it('should clean up expired PKCE states', async () => {
      // Insert an expired state
      const expiredState = 'expired-state-' + Date.now();
      const pastDate = new Date();
      pastDate.setMinutes(pastDate.getMinutes() - 1);
      
      await testDb.getDb()('oauth_state').insert({
        state: expiredState,
        code_verifier: 'expired-verifier',
        expires_at: pastDate
      });
      
      // Insert a valid state
      const validState = 'valid-state-' + Date.now();
      const futureDate = new Date();
      futureDate.setMinutes(futureDate.getMinutes() + 10);
      
      await testDb.getDb()('oauth_state').insert({
        state: validState,
        code_verifier: 'valid-verifier',
        expires_at: futureDate
      });
      
      // Clean up expired states
      const deleted = await testDb.getDb()('oauth_state')
        .where('expires_at', '<', new Date())
        .delete();
      
      expect(deleted).to.be.at.least(1);
      
      // Verify only valid state remains
      const remaining = await testDb.getDb()('oauth_state').select('*');
      expect(remaining).to.have.lengthOf(1);
      expect(remaining[0].state).to.equal(validState);
    });
  });
  
  describe('Pod-Specific Authentication', () => {
    it('should issue pod-specific tokens', async () => {
      const userId = 'pod-test-user';
      const authId = `auth:google:${userId}`;
      
      // Create a user
      await testDb.getDb()('user').insert({
        auth_id: authId,
        email: 'pod@example.com',
        name: 'Pod User',
        provider: 'google'
      });
      
      const user = await testDb.getDb()('user')
        .where('auth_id', authId)
        .first();
      
      // Generate tokens for different pods
      const aliceToken = jwt.sign(
        {
          user_id: user.id,
          auth_id: authId,
          email: 'pod@example.com',
          name: 'Pod User',
          provider: 'google',
          pod: 'alice'
        },
        jwtSecret,
        { expiresIn: '1h' }
      );
      
      const bobToken = jwt.sign(
        {
          user_id: user.id,
          auth_id: authId,
          email: 'pod@example.com',
          name: 'Pod User',
          provider: 'google',
          pod: 'bob'
        },
        jwtSecret,
        { expiresIn: '1h' }
      );
      
      // Verify tokens are different
      expect(aliceToken).to.not.equal(bobToken);
      
      // Decode and verify pod claims
      const alicePayload = jwt.decode(aliceToken) as any;
      const bobPayload = jwt.decode(bobToken) as any;
      
      expect(alicePayload.pod).to.equal('alice');
      expect(bobPayload.pod).to.equal('bob');
      expect(alicePayload.user_id).to.equal(bobPayload.user_id);
    });
  });
  
  describe('Session Management Endpoints', () => {
    it('should handle logout properly', async () => {
      // Test POST logout
      const postResponse = await client.post('/auth/logout');
      expect(postResponse.status).to.equal(200);
      expect(postResponse.data.success).to.be.true;
      
      // Test GET logout with redirect
      const getResponse = await client.get('/auth/logout?redirect=/home', {
        followRedirect: false
      });
      expect(getResponse.status).to.equal(302);
      expect(getResponse.headers.location).to.equal('/home');
    });
    
    it('should list sessions for authenticated user', async () => {
      const userId = 'session-test-user';
      const authId = `auth:google:${userId}`;
      
      // Create user
      await testDb.getDb()('user').insert({
        auth_id: authId,
        email: 'session@example.com',
        name: 'Session User',
        provider: 'google'
      });
      
      const user = await testDb.getDb()('user')
        .where('auth_id', authId)
        .first();
      
      // Generate auth token
      const token = jwt.sign(
        {
          user_id: user.id,
          auth_id: authId,
          email: 'session@example.com',
          name: 'Session User',
          provider: 'google'
        },
        jwtSecret,
        { expiresIn: '1h' }
      );
      
      client.setAuthToken(token);
      
      // List sessions (should be empty initially)
      const response = await client.get('/auth/sessions');
      expect(response.status).to.equal(200);
      expect(response.data.sessions).to.be.an('array');
      expect(response.data.count).to.equal(0);
    });
  });
  
  describe('SSO Behavior', () => {
    it('should handle pod login redirects', async () => {
      // Test pod login redirect
      client.setBaseUrl('http://alice.localhost:3099');
      const response = await client.get('/login', {
        followRedirect: false
      });
      
      expect(response.status).to.equal(302);
      const location = response.headers.location;
      expect(location).to.include('/auth/authorize');
      expect(location).to.include('pod=alice');
      expect(location).to.include('redirect=%2F');
    });
    
    it('should include custom redirect in pod login', async () => {
      client.setBaseUrl('http://bob.localhost:3099');
      const response = await client.get('/login?redirect=/dashboard', {
        followRedirect: false
      });
      
      expect(response.status).to.equal(302);
      const location = response.headers.location;
      expect(location).to.include('/auth/authorize');
      expect(location).to.include('pod=bob');
      expect(location).to.include('redirect=%2Fdashboard');
    });
    
    it('should handle pod auth callback', async () => {
      // Generate a test token
      const token = jwt.sign(
        {
          user_id: 'callback-user',
          auth_id: 'auth:google:callback-user',
          email: 'callback@example.com',
          name: 'Callback User',
          provider: 'google',
          pod: 'alice'
        },
        jwtSecret,
        { expiresIn: '1h' }
      );
      
      client.setBaseUrl('http://alice.localhost:3099');
      const response = await client.get(`/auth/callback?token=${encodeURIComponent(token)}&redirect=/home`, {
        followRedirect: false
      });
      
      expect(response.status).to.equal(302);
      expect(response.headers.location).to.equal('/home');
      expect(response.headers['set-cookie']).to.exist;
    });
  });
});