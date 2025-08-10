// Stream operations tests for WebPods
import { expect } from 'chai';
import jwt from 'jsonwebtoken';
import { client, testDb } from '../test-setup.js';

describe('WebPods Stream Operations', () => {
  let userId: string;
  let authToken: string;
  const testPodId = 'test-pod';
  const baseUrl = `http://${testPodId}.localhost:3099`;

  beforeEach(async () => {
    // Create a test user and auth token
    const db = testDb.getDb();
    const [user] = await db('user').insert({
      id: crypto.randomUUID(),
      auth_id: 'auth:github:123456',
      email: 'test@example.com',
      name: 'Test User',
      provider: 'github'
    }).returning('*');
    
    userId = user.id;
    authToken = jwt.sign(
      {
        user_id: user.id,
        auth_id: user.auth_id,
        email: user.email,
        name: user.name,
        provider: 'github'
      },
      process.env.JWT_SECRET || 'test-secret-key',
      { expiresIn: '1h' }
    );
    
    client.setBaseUrl(baseUrl);
    client.setAuthToken(authToken);
  });

  describe('Pod and Stream Creation', () => {
    it('should create pod and stream on first write', async () => {
      const response = await client.post('/my-first-stream', {
        content: 'Hello WebPods!'
      });
      
      expect(response.status).to.equal(201);
      expect(response.data).to.have.property('sequence_num', 0);
      expect(response.data).to.have.property('content', 'Hello WebPods!');
      expect(response.data).to.have.property('hash');
      expect(response.data).to.have.property('previous_hash', null);
      expect(response.data).to.have.property('author', user.auth_id);
      
      // Verify pod was created
      const db = testDb.getDb();
      const pod = await db('pod').where('pod_id', testPodId).first();
      expect(pod).to.exist;
      
      // Verify stream was created
      const stream = await db('stream')
        .where('pod_id', pod.id)
        .where('stream_id', 'my-first-stream')
        .first();
      expect(stream).to.exist;
      expect(stream.creator_id).to.equal(userId);
      expect(stream.stream_type).to.equal('normal');
    });

    it('should support nested stream paths', async () => {
      const response = await client.post('/blog/posts/2024/january', {
        content: 'January blog post'
      });
      
      expect(response.status).to.equal(201);
      
      // Verify nested path stream was created
      const db = testDb.getDb();
      const pod = await db('pod').where('pod_id', testPodId).first();
      const stream = await db('stream')
        .where('pod_id', pod.id)
        .where('stream_id', 'blog/posts/2024/january')
        .first();
      expect(stream).to.exist;
      expect(stream.stream_id).to.equal('blog/posts/2024/january');
    });

    it('should set custom permissions on stream creation', async () => {
      const response = await client.post('/private-stream?read=private&write=private', {
        content: 'Secret data'
      });
      
      expect(response.status).to.equal(201);
      
      const db = testDb.getDb();
      const pod = await db('pod').where('pod_id', testPodId).first();
      const stream = await db('stream')
        .where('pod_id', pod.id)
        .where('stream_id', 'private-stream')
        .first();
      expect(stream.read_permission).to.equal('private');
      expect(stream.write_permission).to.equal('private');
    });
  });

  describe('Writing Records', () => {
    beforeEach(async () => {
      // Pre-create a stream
      await client.post('/test-stream', 'Initial content');
    });

    it('should write string content', async () => {
      const response = await client.post('/test-stream', 'Plain text message', {
        headers: { 'Content-Type': 'text/plain' }
      });
      expect(response.status).to.equal(201);
      expect(response.data.sequence_num).to.equal(0);
      expect(response.data.content).to.equal('Plain text message');
      expect(response.data.content_type).to.equal('text/plain');
    });

    it('should write JSON content', async () => {
      const data = { message: 'JSON data', count: 42 };
      const response = await client.post('/test-stream', data);
      
      expect(response.status).to.equal(201);
      expect(response.data.content).to.deep.equal(data);
      expect(response.data.content_type).to.equal('application/json');
    });

    it('should respect X-Content-Type header', async () => {
      const response = await client.post('/test-stream', '<h1>HTML</h1>', {
        headers: { 'X-Content-Type': 'text/html' }
      });
      
      expect(response.status).to.equal(201);
      expect(response.data.content_type).to.equal('text/html');
    });

    it('should maintain hash chain', async () => {
      const response1 = await client.post('/hash-test', 'First');
      const response2 = await client.post('/hash-test', 'Second');
      const response3 = await client.post('/hash-test', 'Third');
      
      expect(response1.data.previous_hash).to.be.null;
      expect(response2.data.previous_hash).to.equal(response1.data.hash);
      expect(response3.data.previous_hash).to.equal(response2.data.hash);
      
      // Verify hash format
      expect(response1.data.hash).to.match(/^sha256:[a-f0-9]{64}$/);
    });

    it('should support aliases (including numeric)', async () => {
      // String alias
      const response1 = await client.post('/test-stream?alias=my-post', 'Content with alias');
      expect(response1.status).to.equal(201);
      expect(response1.data.alias).to.equal('my-post');
      
      // Numeric alias (allowed now!)
      const response2 = await client.post('/test-stream?alias=2024', 'Year 2024 content');
      expect(response2.status).to.equal(201);
      expect(response2.data.alias).to.equal('2024');
      
      // Mixed alias
      const response3 = await client.post('/test-stream?alias=post-123', 'Mixed alias');
      expect(response3.status).to.equal(201);
      expect(response3.data.alias).to.equal('post-123');
    });

    it('should reject duplicate aliases', async () => {
      await client.post('/test-stream?alias=unique', 'First');
      const response = await client.post('/test-stream?alias=unique', 'Second');
      
      expect(response.status).to.equal(409);
      expect(response.data.error.code).to.equal('ALIAS_EXISTS');
    });
  });

  describe('Reading Records', () => {
    beforeEach(async () => {
      // Create stream with test data
      await client.post('/read-test', 'First');
      await client.post('/read-test', { data: 'Second' });
      await client.post('/read-test', 'Third');
      await client.post('/read-test?alias=my-alias', 'Aliased');
      await client.post('/read-test?alias=2024', 'Year 2024');
    });

    it('should get record by positive index', async () => {
      const response = await client.get('/read-test?i=0');
      expect(response.status).to.equal(200);
      expect(response.data).to.equal('First');
      
      const response2 = await client.get('/read-test?i=2');
      expect(response2.status).to.equal(200);
      expect(response2.data).to.equal('Third');
    });

    it('should get record by negative index', async () => {
      const response = await client.get('/read-test?i=-1');
      expect(response.status).to.equal(200);
      expect(response.data).to.equal('Year 2024');
      
      const response2 = await client.get('/read-test?i=-5');
      expect(response2.status).to.equal(200);
      expect(response2.data).to.equal('First');
    });

    it('should get range of records', async () => {
      const response = await client.get('/read-test?i=0:3');
      expect(response.status).to.equal(200);
      expect(response.data.records).to.have.lengthOf(3);
      expect(response.data.records[0].content).to.equal('First');
      expect(response.data.records[2].content).to.equal('Third');
    });

    it('should get record by string alias', async () => {
      const response = await client.get('/read-test/my-alias');
      expect(response.status).to.equal(200);
      expect(response.data).to.equal('Aliased');
    });

    it('should get record by numeric alias', async () => {
      const response = await client.get('/read-test/2024');
      expect(response.status).to.equal(200);
      expect(response.data).to.equal('Year 2024');
    });

    it('should list all records with pagination', async () => {
      const response = await client.get('/read-test?limit=2');
      expect(response.status).to.equal(200);
      expect(response.data.records).to.have.lengthOf(2);
      expect(response.data.has_more).to.be.true;
      expect(response.data.next_id).to.equal(1);
      
      // Get next page
      const page2 = await client.get(`/read-test?limit=2&after=${response.data.next_id}`);
      expect(page2.data.records).to.have.lengthOf(2);
    });

    it('should return raw content with metadata in headers', async () => {
      const response = await client.get('/read-test?i=0');
      expect(response.headers['content-type']).to.equal('text/plain');
      expect(response.headers['x-hash']).to.exist;
      expect(response.headers['x-author']).to.equal('auth:github:123456');
      expect(response.headers['x-timestamp']).to.exist;
    });
  });

  describe('System Streams (.meta/)', () => {
    it('should create .meta/owner stream on pod creation', async () => {
      await client.post('/any-stream', 'Create pod');
      
      const db = testDb.getDb();
      const pod = await db('pod').where('pod_id', testPodId).first();
      const ownerStream = await db('stream')
        .where('pod_id', pod.id)
        .where('stream_id', '.meta/owner')
        .first();
      
      expect(ownerStream).to.exist;
      expect(ownerStream.stream_type).to.equal('system');
      expect(ownerStream.write_permission).to.equal('private');
      
      // Check owner record
      const ownerRecord = await db('record')
        .where('stream_id', ownerStream.id)
        .first();
      const content = JSON.parse(ownerRecord.content);
      expect(content.owner).to.equal(userId);
    });

    it('should list streams via .meta/streams', async () => {
      // Create some streams
      await client.post('/stream1', 'Content 1');
      await client.post('/stream2', 'Content 2');
      await client.post('/nested/stream3', 'Content 3');
      
      const response = await client.get('/.meta/streams');
      expect(response.status).to.equal(200);
      expect(response.data.pod).to.equal(testPodId);
      expect(response.data.streams).to.be.an('array');
      expect(response.data.streams.map(s => s.stream_id)).to.include.members([
        'stream1',
        'stream2',
        'nested/stream3',
        '.meta/owner'
      ]);
    });

    it('should update .meta/links for URL routing', async () => {
      await client.post('/homepage', '<h1>Welcome</h1>', {
        headers: { 'X-Content-Type': 'text/html' }
      });
      
      const links = {
        '/': 'homepage?i=-1',
        '/about': 'pages/about',
        '/blog': 'blog?i=-10:-1'
      };
      
      const response = await client.post('/.meta/links', links);
      expect(response.status).to.equal(201);
      
      // Verify links work
      const rootResponse = await client.get('/');
      expect(rootResponse.status).to.equal(200);
      expect(rootResponse.data).to.equal('<h1>Welcome</h1>');
    });

    it('should only allow owner to write to .meta/ streams', async () => {
      // Create second user
      const db = testDb.getDb();
      const [user2] = await db('user').insert({
        id: crypto.randomUUID(),
        auth_id: 'auth:github:789',
        email: 'other@example.com',
        name: 'Other User',
        provider: 'github'
      }).returning('*');
      
      const token2 = jwt.sign(
        {
          user_id: user2.id,
          auth_id: user2.auth_id,
          email: user2.email,
          name: user2.name,
          provider: 'github'
        },
        process.env.JWT_SECRET || 'test-secret-key',
        { expiresIn: '1h' }
      );
      
      // Create pod as first user
      await client.post('/test', 'Create pod');
      
      // Try to update .meta/owner as second user
      client.setAuthToken(token2);
      const response = await client.post('/.meta/owner', { owner: user2.id });
      
      expect(response.status).to.equal(403);
      expect(response.data.error.code).to.equal('FORBIDDEN');
    });
  });

  describe('Permissions', () => {
    it('should enforce private read permissions', async () => {
      await client.post('/private?read=private&write=private', 'Secret');
      
      // Can read as owner
      const response1 = await client.get('/private?i=0');
      expect(response1.status).to.equal(200);
      
      // Cannot read without auth
      client.clearAuthToken();
      const response2 = await client.get('/private?i=0');
      expect(response2.status).to.equal(403);
    });

    it('should support permission streams (allow lists)', async () => {
      // Create permission stream
      await client.post('/members', {
        id: 'auth:github:999',
        read: true,
        write: true
      });
      
      // Create restricted stream
      await client.post('/restricted?read=/members&write=/members', 'Members only');
      
      // Verify permissions stored correctly
      const db = testDb.getDb();
      const pod = await db('pod').where('pod_id', testPodId).first();
      const stream = await db('stream')
        .where('pod_id', pod.id)
        .where('stream_id', 'restricted')
        .first();
      expect(stream.read_permission).to.equal('/members');
      expect(stream.write_permission).to.equal('/members');
    });
  });

  describe('Stream Deletion', () => {
    it('should delete stream and all records', async () => {
      await client.post('/delete-me', 'Message 1');
      await client.post('/delete-me', 'Message 2');
      
      const response = await client.delete('/delete-me');
      expect(response.status).to.equal(204);
      
      // Verify stream is gone
      const getResponse = await client.get('/delete-me');
      expect(getResponse.status).to.equal(404);
    });

    it('should prevent deletion of system streams', async () => {
      await client.post('/test', 'Create pod');
      
      const response = await client.delete('/.meta/owner');
      expect(response.status).to.equal(403);
      expect(response.data.error.code).to.equal('FORBIDDEN');
    });

    it('should only allow creator to delete stream', async () => {
      await client.post('/my-stream', 'Content');
      
      // Create second user and try to delete
      const db = testDb.getDb();
      const [user2] = await db('user').insert({
        id: crypto.randomUUID(),
        auth_id: 'auth:github:999',
        email: 'other@example.com',
        name: 'Other User',
        provider: 'github'
      }).returning('*');
      
      const token2 = jwt.sign(
        { user_id: user2.id, auth_id: user2.auth_id },
        process.env.JWT_SECRET || 'test-secret-key',
        { expiresIn: '1h' }
      );
      
      client.setAuthToken(token2);
      const response = await client.delete('/my-stream');
      expect(response.status).to.equal(403);
    });
  });

  describe('Content Types and Serving', () => {
    it('should serve HTML directly with correct content type', async () => {
      const html = '<html><body><h1>Hello</h1></body></html>';
      await client.post('/page?alias=index', html, {
        headers: { 'X-Content-Type': 'text/html' }
      });
      
      const response = await client.get('/page/index');
      expect(response.status).to.equal(200);
      expect(response.headers['content-type']).to.equal('text/html');
      expect(response.data).to.equal(html);
    });

    it('should serve CSS with correct content type', async () => {
      const css = 'body { margin: 0; }';
      await client.post('/assets/styles?alias=main.css', css, {
        headers: { 'X-Content-Type': 'text/css' }
      });
      
      const response = await client.get('/assets/styles/main.css');
      expect(response.headers['content-type']).to.equal('text/css');
      expect(response.data).to.equal(css);
    });

    it('should serve JSON with correct content type', async () => {
      const data = { api: 'response', version: 1 };
      await client.post('/api/data', data);
      
      const response = await client.get('/api/data?i=-1');
      expect(response.headers['content-type']).to.equal('application/json');
      expect(response.data).to.deep.equal(data);
    });
  });
});