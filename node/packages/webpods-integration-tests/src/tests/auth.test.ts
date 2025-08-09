// Authentication tests
import { expect } from 'chai';
import jwt from 'jsonwebtoken';
import { client, testDb } from '../test-setup.js';

describe('Authentication', () => {
  // Helper to create a test JWT token
  function createTestToken(userId: string, authId: string) {
    return jwt.sign(
      {
        userId,
        authId,
        email: 'test@example.com',
        name: 'Test User',
        provider: 'google'
      },
      'test-secret-key',
      { expiresIn: '1h' }
    );
  }

  describe('OAuth endpoints', () => {
    it('should redirect to OAuth provider', async () => {
      const response = await client.get('/auth/google');
      
      // Should redirect to Google OAuth
      expect(response.status).to.be.oneOf([302, 303]);
    });

    it('should reject invalid OAuth provider', async () => {
      const response = await client.get('/auth/invalid-provider');
      
      expect(response.status).to.equal(400);
      expect(response.data).to.have.property('error');
      expect(response.data.error).to.have.property('code', 'INVALID_PROVIDER');
    });
  });

  describe('Protected endpoints', () => {
    it('should reject requests without auth token', async () => {
      const response = await client.post('/q/test-queue', {
        content: 'test'
      });
      
      expect(response.status).to.equal(401);
      expect(response.data).to.have.property('error');
      expect(response.data.error).to.have.property('code', 'UNAUTHORIZED');
    });

    it('should accept requests with valid auth token', async () => {
      // Insert a test user
      const db = testDb.getDb();
      const [user] = await db('`user`').insert({
        auth_id: 'auth:google:test123',
        email: 'test@example.com',
        name: 'Test User',
        provider: 'google'
      }).returning('*');
      
      const token = createTestToken(user.id, user.auth_id);
      client.setAuthToken(token);
      
      const response = await client.post('/q/test-queue', {
        content: 'test'
      });
      
      expect(response.status).to.equal(201);
      expect(response.data).to.have.property('created', true);
    });

    it('should reject invalid JWT token', async () => {
      client.setAuthToken('invalid-token');
      
      const response = await client.post('/q/test-queue', {
        content: 'test'
      });
      
      expect(response.status).to.equal(401);
      expect(response.data).to.have.property('error');
      expect(response.data.error).to.have.property('code', 'UNAUTHORIZED');
    });
  });
});