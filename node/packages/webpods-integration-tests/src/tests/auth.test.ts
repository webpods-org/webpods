// Authentication tests for WebPods
import { expect } from 'chai';
import jwt from 'jsonwebtoken';
import { client, testDb } from '../test-setup.js';

describe('WebPods Authentication', () => {
  const testPodId = 'auth-test';
  const baseUrl = `http://${testPodId}.localhost:3099`;
  
  // Helper to create a test JWT token
  function createTestToken(userId: string, authId: string, email: string = 'test@example.com') {
    return jwt.sign(
      {
        user_id: userId,
        auth_id: authId,
        email,
        name: 'Test User',
        provider: 'google'
      },
      process.env.JWT_SECRET || 'test-secret-key',
      { expiresIn: '1h' }
    );
  }

  beforeEach(() => {
    client.setBaseUrl(baseUrl);
  });

  describe('OAuth Endpoints', () => {
    it('should redirect to Google OAuth', async () => {
      // Auth endpoints are on the main domain, not pod subdomains
      client.setBaseUrl('http://localhost:3099');
      const response = await client.get('/auth/google', { 
        followRedirect: false 
      });
      
      expect(response.status).to.be.oneOf([302, 303]);
      expect(response.headers.location).to.include('accounts.google.com');
    });

    it('should redirect to GitHub OAuth', async () => {
      client.setBaseUrl('http://localhost:3099');
      const response = await client.get('/auth/github', { 
        followRedirect: false 
      });
      
      expect(response.status).to.be.oneOf([302, 303]);
      expect(response.headers.location).to.include('github.com/login/oauth');
    });

    it('should reject invalid OAuth provider', async () => {
      client.setBaseUrl('http://localhost:3099');
      const response = await client.get('/auth/invalid-provider');
      
      expect(response.status).to.equal(400);
    });

    it('should handle OAuth callback', async () => {
      client.setBaseUrl('http://localhost:3099');
      const response = await client.get('/auth/google/callback?code=test-code&state=test-state');
      
      // Will fail due to invalid code, but endpoint should exist
      expect(response.status).to.be.oneOf([400, 401]);
    });
  });

  describe('JWT Authentication', () => {
    let userId: string;
    let authToken: string;

    beforeEach(async () => {
      // Create a test user
      const db = testDb.getDb();
      const [user] = await db('user').insert({
        id: crypto.randomUUID(),
        auth_id: 'auth:google:test123',
        email: 'test@example.com',
        name: 'Test User',
        provider: 'google'
      }).returning('*');
      
      userId = user.id;
      authToken = createTestToken(user.id, user.auth_id);
      client.setBaseUrl(baseUrl);
    });

    it('should reject requests without auth token to write operations', async () => {
      const response = await client.post('/protected-stream', {
        content: 'test content'
      });
      
      expect(response.status).to.equal(401);
      expect(response.data.error.code).to.equal('UNAUTHORIZED');
      expect(response.data.error.message).to.include('Authentication required');
    });

    it('should accept requests with valid auth token', async () => {
      client.setAuthToken(authToken);
      
      const response = await client.post('/protected-stream', {
        content: 'authenticated content'
      });
      
      expect(response.status).to.equal(201);
      expect(response.data).to.have.property('sequence_num', 0);
      expect(response.data).to.have.property('author', 'auth:google:test123');
    });

    it('should reject expired JWT token', async () => {
      const expiredToken = jwt.sign(
        {
          userId,
          auth_id: 'auth:google:test123',
          email: 'test@example.com',
          name: 'Test User',
          provider: 'google'
        },
        process.env.JWT_SECRET || 'test-secret-key',
        { expiresIn: '-1h' } // Already expired
      );
      
      client.setAuthToken(expiredToken);
      
      const response = await client.post('/expired-test', 'content');
      
      expect(response.status).to.equal(401);
      expect(response.data.error.code).to.equal('TOKEN_EXPIRED');
    });

    it('should reject invalid JWT signature', async () => {
      const invalidToken = jwt.sign(
        {
          userId,
          auth_id: 'auth:google:test123',
          email: 'test@example.com'
        },
        'wrong-secret', // Wrong secret
        { expiresIn: '1h' }
      );
      
      client.setAuthToken(invalidToken);
      
      const response = await client.post('/invalid-sig', 'content');
      
      expect(response.status).to.equal(401);
      expect(response.data.error.code).to.equal('INVALID_TOKEN');
    });

    it('should reject malformed JWT token', async () => {
      client.setAuthToken('not.a.valid.jwt.token');
      
      const response = await client.post('/malformed', 'content');
      
      expect(response.status).to.equal(401);
      expect(response.data.error.code).to.equal('INVALID_TOKEN');
    });
  });

  describe('Public vs Authenticated Access', () => {
    let authToken: string;

    beforeEach(async () => {
      const db = testDb.getDb();
      const [user] = await db('user').insert({
        id: crypto.randomUUID(),
        auth_id: 'auth:github:public-test',
        email: 'public@example.com',
        name: 'Public Test User',
        provider: 'github'
      }).returning('*');
      
      authToken = createTestToken(user.id, user.auth_id, user.email);
    });

    it('should allow anonymous read on public streams', async () => {
      // First create a public stream as authenticated user
      client.setAuthToken(authToken);
      await client.post('/public-data', 'Public content');
      
      // Now read without auth
      client.clearAuthToken();
      const response = await client.get('/public-data?i=0');
      
      expect(response.status).to.equal(200);
      expect(response.data).to.equal('Public content');
    });

    it('should require auth for write on public streams', async () => {
      // Try to write without auth
      const response = await client.post('/public-writable', 'Anonymous attempt');
      
      expect(response.status).to.equal(401);
      expect(response.data.error.code).to.equal('UNAUTHORIZED');
    });

    it('should track author correctly', async () => {
      client.setAuthToken(authToken);
      
      const response = await client.post('/tracked', {
        message: 'Track me'
      });
      
      expect(response.status).to.equal(201);
      expect(response.data.author).to.equal('auth:github:public-test');
      
      // Verify in database
      const db = testDb.getDb();
      const pod = await db('pod').where('pod_id', testPodId).first();
      const stream = await db('stream')
        .where('pod_id', pod.id)
        .where('stream_id', 'tracked')
        .first();
      const record = await db('record')
        .where('stream_id', stream.id)
        .first();
      
      expect(record.author_id).to.equal('auth:github:public-test');
    });
  });

  describe('Bearer Token Format', () => {
    let authToken: string;

    beforeEach(async () => {
      const db = testDb.getDb();
      const [user] = await db('user').insert({
        id: crypto.randomUUID(),
        auth_id: 'auth:google:bearer-test',
        email: 'bearer@example.com',
        name: 'Bearer Test',
        provider: 'google'
      }).returning('*');
      
      authToken = createTestToken(user.id, user.auth_id);
    });

    it('should accept Bearer token in Authorization header', async () => {
      const response = await client.post('/bearer-test', 'content', {
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      });
      
      expect(response.status).to.equal(201);
    });

    it('should accept token without Bearer prefix', async () => {
      const response = await client.post('/no-bearer', 'content', {
        headers: {
          'Authorization': authToken
        }
      });
      
      expect(response.status).to.equal(201);
    });

    it('should reject other auth schemes', async () => {
      const response = await client.post('/basic-auth', 'content', {
        headers: {
          'Authorization': `Basic ${Buffer.from('user:pass').toString('base64')}`
        }
      });
      
      expect(response.status).to.equal(401);
    });
  });

  describe('Cross-Pod Authentication', () => {
    let authToken: string;
    let userId: string;

    beforeEach(async () => {
      const db = testDb.getDb();
      const [user] = await db('user').insert({
        id: crypto.randomUUID(),
        auth_id: 'auth:github:cross-pod',
        email: 'cross@example.com',
        name: 'Cross Pod User',
        provider: 'github'
      }).returning('*');
      
      userId = user.id;
      authToken = createTestToken(user.id, user.auth_id);
    });

    it('should use same auth token across different pods', async () => {
      // Write to first pod
      client.setBaseUrl(`http://pod-one.localhost:3099`);
      client.setAuthToken(authToken);
      
      const response1 = await client.post('/stream1', 'Pod one content');
      expect(response1.status).to.equal(201);
      
      // Write to second pod with same token
      client.setBaseUrl(`http://pod-two.localhost:3099`);
      
      const response2 = await client.post('/stream2', 'Pod two content');
      expect(response2.status).to.equal(201);
      
      // Verify both pods exist and have correct ownership
      const db = testDb.getDb();
      const pod1 = await db('pod').where('pod_id', 'pod-one').first();
      const pod2 = await db('pod').where('pod_id', 'pod-two').first();
      
      expect(pod1).to.exist;
      expect(pod2).to.exist;
      
      // Check .meta/owner for both pods
      const owner1Stream = await db('stream')
        .where('pod_id', pod1.id)
        .where('stream_id', '.meta/owner')
        .first();
      const owner1Record = await db('record')
        .where('stream_id', owner1Stream.id)
        .first();
      expect(JSON.parse(owner1Record.content).owner).to.equal(userId);
      
      const owner2Stream = await db('stream')
        .where('pod_id', pod2.id)
        .where('stream_id', '.meta/owner')
        .first();
      const owner2Record = await db('record')
        .where('stream_id', owner2Stream.id)
        .first();
      expect(JSON.parse(owner2Record.content).owner).to.equal(userId);
    });
  });

  describe('User Metadata', () => {
    it('should store user metadata from OAuth', async () => {
      const db = testDb.getDb();
      
      // Simulate OAuth user creation
      const [user] = await db('user').insert({
        id: crypto.randomUUID(),
        auth_id: 'auth:github:12345',
        email: 'oauth@example.com',
        name: 'OAuth User',
        provider: 'github',
        metadata: {
          avatar_url: 'https://github.com/avatar.jpg',
          bio: 'Developer',
          location: 'San Francisco'
        }
      }).returning('*');
      
      expect(user.metadata).to.deep.equal({
        avatar_url: 'https://github.com/avatar.jpg',
        bio: 'Developer',
        location: 'San Francisco'
      });
    });

    it('should handle users from different OAuth providers', async () => {
      const db = testDb.getDb();
      
      // GitHub user
      const [githubUser] = await db('user').insert({
        id: crypto.randomUUID(),
        auth_id: 'auth:github:gh123',
        email: 'github@example.com',
        name: 'GitHub User',
        provider: 'github'
      }).returning('*');
      
      // Google user
      const [googleUser] = await db('user').insert({
        id: crypto.randomUUID(),
        auth_id: 'auth:google:g456',
        email: 'google@example.com',
        name: 'Google User',
        provider: 'google'
      }).returning('*');
      
      expect(githubUser.provider).to.equal('github');
      expect(githubUser.auth_id).to.match(/^auth:github:/);
      
      expect(googleUser.provider).to.equal('google');
      expect(googleUser.auth_id).to.match(/^auth:google:/);
    });
  });
});