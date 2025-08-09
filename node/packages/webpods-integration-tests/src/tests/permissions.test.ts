// Permission tests
import { expect } from 'chai';
import jwt from 'jsonwebtoken';
import { client, testDb } from '../test-setup.js';

describe('Permissions', () => {
  let user1Id: string;
  let user1Token: string;
  let user2Id: string;
  let user2Token: string;

  beforeEach(async () => {
    const db = testDb.getDb();
    
    // Create two test users
    const [user1] = await db('`user`').insert({
      auth_id: 'auth:google:user1',
      email: 'user1@example.com',
      name: 'User One',
      provider: 'google'
    }).returning('*');
    
    const [user2] = await db('`user`').insert({
      auth_id: 'auth:google:user2',
      email: 'user2@example.com', 
      name: 'User Two',
      provider: 'google'
    }).returning('*');
    
    user1Id = user1.id;
    user2Id = user2.id;
    
    user1Token = jwt.sign({
      userId: user1.id,
      authId: user1.auth_id,
      email: user1.email,
      name: user1.name,
      provider: 'google'
    }, 'test-secret-key', { expiresIn: '1h' });
    
    user2Token = jwt.sign({
      userId: user2.id,
      authId: user2.auth_id,
      email: user2.email,
      name: user2.name,
      provider: 'google'
    }, 'test-secret-key', { expiresIn: '1h' });
  });

  describe('Private queues', () => {
    it('should only allow creator to read private queue', async () => {
      // User1 creates private queue
      client.setAuthToken(user1Token);
      await client.post('/q/private-read?read=private', 'Secret message');
      
      // User1 can read
      const response1 = await client.get('/q/private-read');
      expect(response1.status).to.equal(200);
      expect(response1.data.records[0]).to.equal('Secret message');
      
      // User2 cannot read
      client.setAuthToken(user2Token);
      const response2 = await client.get('/q/private-read');
      expect(response2.status).to.equal(403);
      expect(response2.data.error.code).to.equal('FORBIDDEN');
      
      // Anonymous cannot read
      client.clearAuthToken();
      const response3 = await client.get('/q/private-read');
      expect(response3.status).to.equal(403);
    });

    it('should only allow creator to write to private queue', async () => {
      // User1 creates private write queue
      client.setAuthToken(user1Token);
      await client.post('/q/private-write?write=private', 'First message');
      
      // User2 cannot write
      client.setAuthToken(user2Token);
      const response = await client.post('/q/private-write', 'Attempt to write');
      expect(response.status).to.equal(403);
      expect(response.data.error.code).to.equal('FORBIDDEN');
      
      // User1 can write
      client.setAuthToken(user1Token);
      const response2 = await client.post('/q/private-write', 'Second message');
      expect(response2.status).to.equal(201);
    });
  });

  describe('Public queues', () => {
    it('should allow anyone to read public queue', async () => {
      // User1 creates public queue
      client.setAuthToken(user1Token);
      await client.post('/q/public-queue', 'Public message');
      
      // User2 can read
      client.setAuthToken(user2Token);
      const response1 = await client.get('/q/public-queue');
      expect(response1.status).to.equal(200);
      
      // Anonymous can read
      client.clearAuthToken();
      const response2 = await client.get('/q/public-queue');
      expect(response2.status).to.equal(200);
    });

    it('should allow any authenticated user to write to public queue', async () => {
      // User1 creates public queue
      client.setAuthToken(user1Token);
      await client.post('/q/public-write', 'Message 1');
      
      // User2 can write
      client.setAuthToken(user2Token);
      const response = await client.post('/q/public-write', 'Message 2');
      expect(response.status).to.equal(201);
      
      // Verify both messages exist
      const list = await client.get('/q/public-write');
      expect(list.data.records).to.have.lengthOf(2);
    });
  });

  describe('Allow/Deny lists', () => {
    it('should support allow lists for reading', async () => {
      client.setAuthToken(user1Token);
      
      // Create allow list queue
      await client.post('/q/allowed-users', {
        id: 'auth:google:user2',
        read: true,
        write: false
      });
      
      // Create queue with allow list
      await client.post('/q/restricted?read=/allowed-users', 'Restricted content');
      
      // User2 can read (in allow list)
      client.setAuthToken(user2Token);
      const response1 = await client.get('/q/restricted');
      expect(response1.status).to.equal(200);
      
      // User1 can read (creator)
      client.setAuthToken(user1Token);
      const response2 = await client.get('/q/restricted');
      expect(response2.status).to.equal(200);
    });

    it('should support deny lists for writing', async () => {
      client.setAuthToken(user1Token);
      
      // Create deny list queue
      await client.post('/q/blocked-users', {
        id: 'auth:google:user2',
        read: false,
        write: false
      });
      
      // Create queue with deny list
      await client.post('/q/moderated?write=~/blocked-users', 'Initial message');
      
      // User2 cannot write (in deny list)
      client.setAuthToken(user2Token);
      const response = await client.post('/q/moderated', 'Blocked attempt');
      expect(response.status).to.equal(403);
      
      // Update deny list to unblock user2
      client.setAuthToken(user1Token);
      await client.post('/q/blocked-users', {
        id: 'auth:google:user2',
        read: true,
        write: true
      });
      
      // Now user2 can write
      client.setAuthToken(user2Token);
      const response2 = await client.post('/q/moderated', 'Now allowed');
      expect(response2.status).to.equal(201);
    });
  });

  describe('Permission updates', () => {
    it('should only allow creator to update permissions', async () => {
      // User1 creates queue
      client.setAuthToken(user1Token);
      await client.post('/q/perm-update', 'Initial');
      
      // User2 cannot update permissions
      client.setAuthToken(user2Token);
      const response = await client.post('/q/perm-update?read=private');
      expect(response.status).to.equal(403);
      
      // User1 can update permissions
      client.setAuthToken(user1Token);
      const response2 = await client.post('/q/perm-update?read=private&write=private');
      expect(response2.status).to.equal(201);
      
      // Verify permissions were updated
      const db = testDb.getDb();
      const queue = await db('queue').where('q_id', 'perm-update').first();
      expect(queue.read_permission).to.equal('private');
      expect(queue.write_permission).to.equal('private');
    });
  });
});