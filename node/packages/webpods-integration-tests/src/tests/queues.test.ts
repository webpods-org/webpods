// Queue operations tests
import { expect } from 'chai';
import jwt from 'jsonwebtoken';
import { client, testDb } from '../test-setup.js';

describe('Queue Operations', () => {
  let userId: string;
  let authToken: string;

  beforeEach(async () => {
    // Create a test user and auth token
    const db = testDb.getDb();
    const [user] = await db('`user`').insert({
      auth_id: 'auth:google:test123',
      email: 'test@example.com',
      name: 'Test User',
      provider: 'google'
    }).returning('*');
    
    userId = user.id;
    authToken = jwt.sign(
      {
        userId: user.id,
        authId: user.auth_id,
        email: user.email,
        name: user.name,
        provider: 'google'
      },
      'test-secret-key',
      { expiresIn: '1h' }
    );
    
    client.setAuthToken(authToken);
  });

  describe('POST /q/:q_id', () => {
    it('should create a new queue on first write', async () => {
      const response = await client.post('/q/test-queue', {
        content: 'First message'
      });
      
      expect(response.status).to.equal(201);
      expect(response.data).to.have.property('id');
      expect(response.data).to.have.property('q_id', 'test-queue');
      expect(response.data).to.have.property('created', true);
      
      // Verify queue was created
      const db = testDb.getDb();
      const queue = await db('queue').where('q_id', 'test-queue').first();
      expect(queue).to.exist;
      expect(queue.creator_id).to.equal(userId);
    });

    it('should write string content', async () => {
      const response = await client.post('/q/string-queue', 'Plain text message', {
        'Content-Type': 'text/plain'
      });
      
      expect(response.status).to.equal(201);
      
      // Verify record was created
      const db = testDb.getDb();
      const record = await db('record')
        .join('queue', 'record.queue_id', 'queue.id')
        .where('queue.q_id', 'string-queue')
        .select('record.*')
        .first();
      
      expect(record).to.exist;
      expect(record.content).to.deep.equal({ value: 'Plain text message' });
      expect(record.content_type).to.equal('text/plain');
    });

    it('should write JSON content', async () => {
      const data = { message: 'JSON data', count: 42 };
      const response = await client.post('/q/json-queue', data);
      
      expect(response.status).to.equal(201);
      
      // Verify record was created
      const db = testDb.getDb();
      const record = await db('record')
        .join('queue', 'record.queue_id', 'queue.id')
        .where('queue.q_id', 'json-queue')
        .select('record.*')
        .first();
      
      expect(record).to.exist;
      expect(record.content).to.deep.equal(data);
      expect(record.content_type).to.equal('application/json');
    });

    it('should store metadata from X-* headers', async () => {
      const response = await client.post('/q/metadata-queue', 'Content', {
        'X-Author': 'Test Author',
        'X-Title': 'Test Title',
        'X-Category': 'Testing'
      });
      
      expect(response.status).to.equal(201);
      
      // Verify metadata was stored
      const db = testDb.getDb();
      const record = await db('record')
        .join('queue', 'record.queue_id', 'queue.id')
        .where('queue.q_id', 'metadata-queue')
        .select('record.*')
        .first();
      
      expect(record.metadata).to.deep.include({
        'author': 'Test Author',
        'title': 'Test Title',
        'category': 'Testing'
      });
    });

    it('should auto-increment sequence numbers', async () => {
      await client.post('/q/seq-queue', 'Message 1');
      await client.post('/q/seq-queue', 'Message 2');
      await client.post('/q/seq-queue', 'Message 3');
      
      const db = testDb.getDb();
      const records = await db('record')
        .join('queue', 'record.queue_id', 'queue.id')
        .where('queue.q_id', 'seq-queue')
        .select('record.sequence_num')
        .orderBy('sequence_num');
      
      expect(records).to.have.lengthOf(3);
      expect(records[0]?.sequence_num).to.equal(1);
      expect(records[1]?.sequence_num).to.equal(2);
      expect(records[2]?.sequence_num).to.equal(3);
    });

    it('should create queue with custom permissions', async () => {
      const response = await client.post('/q/private-queue?read=private&write=private');
      
      expect(response.status).to.equal(201);
      
      const db = testDb.getDb();
      const queue = await db('queue').where('q_id', 'private-queue').first();
      expect(queue.read_permission).to.equal('private');
      expect(queue.write_permission).to.equal('private');
    });
  });

  describe('GET /q/:q_id', () => {
    beforeEach(async () => {
      // Create a queue with some records
      await client.post('/q/read-test', 'Message 1');
      await client.post('/q/read-test', { data: 'Message 2' });
      await client.post('/q/read-test', 'Message 3');
    });

    it('should list all records in queue', async () => {
      const response = await client.get('/q/read-test');
      
      expect(response.status).to.equal(200);
      expect(response.data).to.have.property('record');
      expect(response.data.records).to.have.lengthOf(3);
      expect(response.data.records[0]).to.equal('Message 1');
      expect(response.data.records[1]).to.deep.equal({ data: 'Message 2' });
      expect(response.data.records[2]).to.equal('Message 3');
      expect(response.data).to.have.property('total', 3);
      expect(response.data).to.have.property('has_more', false);
    });

    it('should support pagination', async () => {
      // Add more records
      for (let i = 4; i <= 10; i++) {
        await client.post('/q/read-test', `Message ${i}`);
      }
      
      // Get first page
      const page1 = await client.get('/q/read-test', { limit: 5 });
      expect(page1.data.records).to.have.lengthOf(5);
      expect(page1.data.has_more).to.be.true;
      expect(page1.data.next_id).to.exist;
      
      // Get second page
      const page2 = await client.get('/q/read-test', { 
        limit: 5, 
        after: page1.data.next_id 
      });
      expect(page2.data.records).to.have.lengthOf(5);
    });

    it('should return 404 for non-existent queue', async () => {
      const response = await client.get('/q/non-existent');
      
      expect(response.status).to.equal(404);
      expect(response.data).to.have.property('error');
      expect(response.data.error).to.have.property('code', 'NOT_FOUND');
    });
  });

  describe('GET /q/:q_id/:index', () => {
    beforeEach(async () => {
      await client.post('/q/index-test', 'First');
      await client.post('/q/index-test', 'Second');
      await client.post('/q/index-test', 'Third');
    });

    it('should get record by positive index', async () => {
      const response = await client.get('/q/index-test/0');
      expect(response.status).to.equal(200);
      expect(response.data).to.equal('First');
      
      const response2 = await client.get('/q/index-test/2');
      expect(response2.status).to.equal(200);
      expect(response2.data).to.equal('Third');
    });

    it('should get record by negative index', async () => {
      const response = await client.get('/q/index-test/-1');
      expect(response.status).to.equal(200);
      expect(response.data).to.equal('Third');
      
      const response2 = await client.get('/q/index-test/-3');
      expect(response2.status).to.equal(200);
      expect(response2.data).to.equal('First');
    });

    it('should return 404 for out of range index', async () => {
      const response = await client.get('/q/index-test/10');
      expect(response.status).to.equal(404);
      
      const response2 = await client.get('/q/index-test/-10');
      expect(response2.status).to.equal(404);
    });

    it('should return metadata in headers', async () => {
      await client.post('/q/meta-test', 'Content', {
        'X-Author': 'Test',
        'X-Version': '1.0'
      });
      
      const response = await client.get('/q/meta-test/0');
      expect(response.headers['x-author']).to.equal('Test');
      expect(response.headers['x-version']).to.equal('1.0');
    });
  });

  describe('DELETE /q/:q_id', () => {
    it('should delete queue and all records', async () => {
      // Create queue with records
      await client.post('/q/delete-test', 'Message 1');
      await client.post('/q/delete-test', 'Message 2');
      
      const response = await client.delete('/q/delete-test');
      
      expect(response.status).to.equal(200);
      expect(response.data).to.have.property('q_id', 'delete-test');
      expect(response.data).to.have.property('deleted', true);
      expect(response.data).to.have.property('record_deleted', 2);
      
      // Verify queue is gone
      const getResponse = await client.get('/q/delete-test');
      expect(getResponse.status).to.equal(404);
    });

    it('should return 404 for non-existent queue', async () => {
      const response = await client.delete('/q/non-existent');
      
      expect(response.status).to.equal(404);
      expect(response.data).to.have.property('error');
      expect(response.data.error).to.have.property('code', 'NOT_FOUND');
    });

    it('should only allow creator to delete queue', async () => {
      // Create queue as first user
      await client.post('/q/creator-test', 'Message');
      
      // Create second user
      const db = testDb.getDb();
      const [user2] = await db('`user`').insert({
        auth_id: 'auth:google:other',
        email: 'other@example.com',
        name: 'Other User',
        provider: 'google'
      }).returning('*');
      
      const token2 = jwt.sign(
        {
          userId: user2.id,
          authId: user2.auth_id,
          email: user2.email,
          name: user2.name,
          provider: 'google'
        },
        'test-secret-key',
        { expiresIn: '1h' }
      );
      
      client.setAuthToken(token2);
      
      const response = await client.delete('/q/creator-test');
      expect(response.status).to.equal(403);
      expect(response.data.error).to.have.property('code', 'FORBIDDEN');
    });
  });

  describe('HEAD /q/:q_id', () => {
    it('should return queue metadata in headers', async () => {
      await client.post('/q/head-test', 'Message 1');
      await client.post('/q/head-test', 'Message 2');
      
      const response = await client.head('/q/head-test');
      
      expect(response.status).to.equal(200);
      expect(response.headers['x-total-records']).to.equal('2');
      expect(response.headers['x-last-modified']).to.exist;
      expect(response.headers['x-hash']).to.exist;
    });
  });
});