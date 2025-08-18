// Alias validation tests for WebPods
import { expect } from 'chai';
import { TestHttpClient } from 'webpods-test-utils';
import { testDb } from '../test-setup.js';

describe('WebPods Alias Validation', () => {
  let client: TestHttpClient;
  let authToken: string;
  const testPodId = 'test-aliases';
  const baseUrl = `http://${testPodId}.localhost:3099`;

  beforeEach(async () => {
    client = new TestHttpClient('http://localhost:3099');
    // Create a test user and auth token
    const db = testDb.getDb();
    const [user] = await db('user').insert({
      id: crypto.randomUUID(),
      auth_id: 'auth:provider:alias123',
      email: 'alias@example.com',
      name: 'Alias Test User',
      provider: 'testprovider1'
    }).returning('*');
    
    // Generate pod-specific token
    client.setBaseUrl(baseUrl);
    authToken = client.generatePodToken({
      user_id: user.id,
      auth_id: user.auth_id,
      email: user.email,
      name: user.name,
      provider: 'testprovider1'
    }, testPodId);
    
    client.setAuthToken(authToken);
  });

  describe('Valid Aliases', () => {
    it('should accept simple alphanumeric aliases', async () => {
      const validAliases = [
        'simple',
        'test123',
        'ABC',
        '12345',
        'MixedCase123'
      ];

      for (const alias of validAliases) {
        const response = await client.post(`/stream?alias=${alias}`, `Content for ${alias}`);
        expect(response.status).to.equal(201, `Failed for alias: ${alias}`);
        expect(response.data).to.have.property('alias', alias);
      }
    });

    it('should accept aliases with hyphens and underscores', async () => {
      const validAliases = [
        'my-alias',
        'test_name',
        'mixed-with_both',
        'kebab-case-example',
        'snake_case_example'
      ];

      for (const alias of validAliases) {
        const response = await client.post(`/hyphen-underscore?alias=${alias}`, `Content for ${alias}`);
        expect(response.status).to.equal(201, `Failed for alias: ${alias}`);
        expect(response.data).to.have.property('alias', alias);
      }
    });

    it('should accept aliases with periods (but not at start/end)', async () => {
      const validAliases = [
        'file.txt',
        'index.html',
        'logo.png',
        'archive.tar.gz',
        'v1.2.3',
        'data.backup.2024'
      ];

      for (const alias of validAliases) {
        const response = await client.post(`/files?alias=${alias}`, `Content for ${alias}`);
        expect(response.status).to.equal(201, `Failed for alias: ${alias}`);
        expect(response.data).to.have.property('alias', alias);
      }
    });

    it('should accept maximum length aliases', async () => {
      // 256 characters is the max
      const longAlias = 'a'.repeat(256);
      const response = await client.post(`/long?alias=${longAlias}`, 'Content');
      expect(response.status).to.equal(201);
      expect(response.data).to.have.property('alias', longAlias);
    });
  });

  describe('Invalid Aliases', () => {
    it('should reject aliases with slashes', async () => {
      const invalidAliases = [
        'path/to/file',
        'folder/image.png',
        '../etc/passwd',
        '../../admin',
        'file\\name',
        '/absolute/path'
      ];

      for (const alias of invalidAliases) {
        const response = await client.post(`/invalid-slash?alias=${encodeURIComponent(alias)}`, 'Content');
        expect(response.status).to.equal(400, `Should reject alias: ${alias}`);
        expect(response.data.error.code).to.equal('INVALID_ALIAS');
        expect(response.data.error.message).to.include('can only contain');
      }
    });

    it('should reject aliases starting or ending with periods', async () => {
      const invalidAliases = [
        '.hidden',
        'file.',
        '..',
        '.',
        '.start.middle',
        'middle.end.'
      ];

      for (const alias of invalidAliases) {
        const response = await client.post(`/invalid-period?alias=${encodeURIComponent(alias)}`, 'Content');
        expect(response.status).to.equal(400, `Should reject alias: ${alias}`);
        expect(response.data.error.code).to.equal('INVALID_ALIAS');
      }
    });

    it('should reject aliases with special characters', async () => {
      const invalidAliases = [
        'hello world',      // space
        'file@name',       // @
        'price$100',       // $
        '50%off',          // %
        'question?',       // ?
        'file*pattern',    // *
        'a:b',            // :
        'quote"test',      // "
        'less<more',       // <
        'pipe|test',       // |
        'hash#tag',        // #
        'plus+minus',      // +
        'equal=sign',      // =
        'bracket[0]',      // []
        'curly{brace}',    // {}
        'exclaim!',        // !
        'tilde~test',      // ~
        'back`tick',       // `
        'semi;colon',      // ;
        'paren(test)',     // ()
        'and&test',        // &
        'caret^test'       // ^
      ];

      for (const alias of invalidAliases) {
        const response = await client.post(`/invalid-special?alias=${encodeURIComponent(alias)}`, 'Content');
        expect(response.status).to.equal(400, `Should reject alias: ${alias}`);
        expect(response.data.error.code).to.equal('INVALID_ALIAS');
      }
    });

    it('should reject empty alias', async () => {
      const response = await client.post('/empty?alias=', 'Content');
      expect(response.status).to.equal(400);
      expect(response.data.error.code).to.equal('INVALID_ALIAS');
    });

    it('should reject alias exceeding maximum length', async () => {
      const tooLongAlias = 'a'.repeat(257); // 257 characters
      const response = await client.post(`/toolong?alias=${tooLongAlias}`, 'Content');
      expect(response.status).to.equal(400);
      expect(response.data.error.code).to.equal('INVALID_ALIAS');
    });
  });

  describe('Alias Access Patterns', () => {
    it('should correctly route to stream with valid alias', async () => {
      // Create records with valid aliases
      await client.post('/products?alias=laptop-2024', 'Laptop details');
      await client.post('/products?alias=phone_v2', 'Phone details');
      await client.post('/products?alias=tablet.pro', 'Tablet details');

      // Access them
      let response = await client.get('/products/laptop-2024');
      expect(response.status).to.equal(200);
      expect(response.data).to.equal('Laptop details');

      response = await client.get('/products/phone_v2');
      expect(response.status).to.equal(200);
      expect(response.data).to.equal('Phone details');

      response = await client.get('/products/tablet.pro');
      expect(response.status).to.equal(200);
      expect(response.data).to.equal('Tablet details');
    });

    it('should handle nested streams with aliases correctly', async () => {
      // Create nested stream with alias
      await client.post('/docs/api/v1?alias=intro.md', 'API Introduction');
      await client.post('/docs/api/v1?alias=auth.html', 'Authentication Guide');

      // Access them - clear that "intro.md" is an alias, not a path
      let response = await client.get('/docs/api/v1/intro.md');
      expect(response.status).to.equal(200);
      expect(response.data).to.equal('API Introduction');

      response = await client.get('/docs/api/v1/auth.html');
      expect(response.status).to.equal(200);
      expect(response.data).to.equal('Authentication Guide');
    });
  });

  describe('Security', () => {
    it('should prevent path traversal attempts via aliases', async () => {
      // These should all be rejected at write time
      const attacks = [
        '../../etc/passwd',
        '../../../root/.ssh/id_rsa',
        'valid/../../../etc/shadow',
        './../admin'
      ];

      for (const attack of attacks) {
        const response = await client.post(`/secure?alias=${encodeURIComponent(attack)}`, 'Evil content');
        expect(response.status).to.equal(400, `Should block: ${attack}`);
        expect(response.data.error.code).to.equal('INVALID_ALIAS');
      }
    });

    it('should not allow URL hijacking through alias manipulation', async () => {
      // Create a legitimate record
      await client.post('/pages?alias=home', 'Real homepage');

      // Try to create confusing aliases that might hijack URLs
      const hijackAttempts = [
        'home/../../admin',  // Contains slashes - rejected
        'home%2F..%2Fadmin', // URL encoded slashes - rejected as special chars
        'home/../admin'      // Path traversal - rejected
      ];

      for (const attempt of hijackAttempts) {
        const response = await client.post(`/pages?alias=${encodeURIComponent(attempt)}`, 'Hijack attempt');
        expect(response.status).to.equal(400, `Should block: ${attempt}`);
      }
    });
  });
});