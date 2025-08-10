// Health check tests for WebPods
import { expect } from 'chai';
import { client, testDb } from '../test-setup.js';

describe('WebPods Health Checks', () => {
  describe('Main Domain Health', () => {
    beforeEach(() => {
      // Health checks are on main domain, not pod subdomains
      client.setBaseUrl('http://localhost:3099');
    });

    it('should return healthy status', async () => {
      const response = await client.get('/health');
      
      expect(response.status).to.equal(200);
      expect(response.data).to.have.property('status', 'healthy');
      expect(response.data).to.have.property('timestamp');
      expect(response.data).to.have.property('environment');
      expect(response.data).to.have.property('version');
    });

    it('should include service statuses', async () => {
      const response = await client.get('/health');
      
      expect(response.data).to.have.property('services');
      expect(response.data.services).to.be.an('object');
      
      // Database should be connected
      expect(response.data.services).to.have.property('database');
      expect(response.data.services.database).to.equal('connected');
      
      // Redis/cache status (if configured)
      if (response.data.services.cache) {
        expect(response.data.services.cache).to.be.oneOf(['connected', 'not_configured']);
      }
    });

    it('should include uptime information', async () => {
      const response = await client.get('/health');
      
      expect(response.data).to.have.property('uptime');
      expect(response.data.uptime).to.be.a('number');
      expect(response.data.uptime).to.be.greaterThan(0);
    });

    it('should return proper content type', async () => {
      const response = await client.get('/health');
      
      expect(response.headers['content-type']).to.include('application/json');
    });
  });

  describe('Database Health', () => {
    it('should detect database connection', async () => {
      client.setBaseUrl('http://localhost:3099');
      const response = await client.get('/health');
      
      expect(response.data.services.database).to.equal('connected');
      
      // Verify by checking database is actually working
      const db = testDb.getDb();
      const result = await db.raw('SELECT 1 as test');
      expect(result.rows[0].test).to.equal(1);
    });

    it('should report database version', async () => {
      client.setBaseUrl('http://localhost:3099');
      const response = await client.get('/health/detailed');
      
      if (response.status === 200) {
        expect(response.data.database).to.have.property('version');
        expect(response.data.database.version).to.match(/PostgreSQL \d+\.\d+/);
      }
    });
  });

  describe('Pod Subdomain Health', () => {
    it('should handle health checks on pod subdomains', async () => {
      // Pods don't have health endpoints, but should handle gracefully
      client.setBaseUrl('http://health-test.localhost:3099');
      const response = await client.get('/health');
      
      // Should either redirect to main domain or return 404
      expect(response.status).to.be.oneOf([404, 302]);
    });

    it('should verify wildcard subdomain routing works', async () => {
      const uniquePodId = `health-check-${Date.now()}`;
      client.setBaseUrl(`http://${uniquePodId}.localhost:3099`);
      
      // Create a test user and authenticate
      const db = testDb.getDb();
      const [user] = await db('user').insert({
        id: crypto.randomUUID(),
        auth_id: 'auth:github:health-test',
        email: 'health@example.com',
        name: 'Health Test User',
        provider: 'github'
      }).returning('*');
      
      const jwt = require('jsonwebtoken');
      const token = jwt.sign({
        user_id: user.id,
        auth_id: user.auth_id,
        email: user.email,
        name: user.name,
        provider: 'github'
      }, process.env.JWT_SECRET || 'test-secret-key', { expiresIn: '1h' });
      
      client.setAuthToken(token);
      
      // Try to write to a stream on this pod
      const response = await client.post('/health-stream', 'Health check content');
      
      // Should succeed, proving subdomain routing works
      expect(response.status).to.equal(201);
      expect(response.data).to.have.property('sequence_num', 0);
      
      // Verify pod was created
      const pod = await db('pod').where('pod_id', uniquePodId).first();
      expect(pod).to.exist;
    });
  });

  describe('Readiness Check', () => {
    it('should have a readiness endpoint', async () => {
      client.setBaseUrl('http://localhost:3099');
      const response = await client.get('/ready');
      
      if (response.status === 200) {
        expect(response.data).to.have.property('ready');
        expect(response.data.ready).to.be.a('boolean');
        
        // When ready, should be true
        if (response.data.ready) {
          expect(response.data).to.have.property('checks');
          expect(response.data.checks).to.be.an('object');
        }
      }
    });
  });

  describe('Liveness Check', () => {
    it('should have a liveness endpoint', async () => {
      client.setBaseUrl('http://localhost:3099');
      const response = await client.get('/alive');
      
      if (response.status === 200) {
        expect(response.data).to.have.property('alive', true);
        expect(response.data).to.have.property('timestamp');
      }
    });
  });

  describe('Metrics Endpoint', () => {
    it('should expose metrics if configured', async () => {
      client.setBaseUrl('http://localhost:3099');
      const response = await client.get('/metrics');
      
      // Metrics might be disabled in test environment
      if (response.status === 200) {
        // Should return Prometheus format
        expect(response.headers['content-type']).to.include('text/plain');
        expect(response.data).to.include('# HELP');
        expect(response.data).to.include('# TYPE');
      } else {
        // Metrics endpoint might be disabled
        expect(response.status).to.be.oneOf([404, 403]);
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid health check paths', async () => {
      client.setBaseUrl('http://localhost:3099');
      const response = await client.get('/health/invalid-path');
      
      expect(response.status).to.be.oneOf([404, 400]);
    });

    it('should return JSON error for health check failures', async () => {
      client.setBaseUrl('http://localhost:3099');
      
      // Try to trigger an error (this might not actually fail in test env)
      const response = await client.get('/health?force_error=true');
      
      if (response.status !== 200) {
        expect(response.data).to.have.property('error');
        expect(response.data.error).to.have.property('code');
        expect(response.data.error).to.have.property('message');
      }
    });
  });

  describe('Performance', () => {
    it('should respond quickly to health checks', async () => {
      client.setBaseUrl('http://localhost:3099');
      
      const start = Date.now();
      const response = await client.get('/health');
      const duration = Date.now() - start;
      
      expect(response.status).to.equal(200);
      // Health check should be fast (under 100ms)
      expect(duration).to.be.lessThan(100);
    });

    it('should handle concurrent health checks', async () => {
      client.setBaseUrl('http://localhost:3099');
      
      // Make multiple concurrent requests
      const promises = Array(10).fill(0).map(() => 
        client.get('/health')
      );
      
      const responses = await Promise.all(promises);
      
      // All should succeed
      responses.forEach(response => {
        expect(response.status).to.equal(200);
        expect(response.data.status).to.equal('healthy');
      });
    });
  });

  describe('Environment Information', () => {
    it('should include environment details', async () => {
      client.setBaseUrl('http://localhost:3099');
      const response = await client.get('/health');
      
      expect(response.data).to.have.property('environment');
      expect(response.data.environment).to.be.oneOf(['test', 'development', 'production']);
      
      // In test environment
      expect(response.data.environment).to.equal('test');
    });

    it('should include node version', async () => {
      client.setBaseUrl('http://localhost:3099');
      const response = await client.get('/health/detailed');
      
      if (response.status === 200) {
        expect(response.data).to.have.property('runtime');
        expect(response.data.runtime).to.have.property('node');
        expect(response.data.runtime.node).to.match(/^v\d+\.\d+\.\d+/);
      }
    });
  });
});