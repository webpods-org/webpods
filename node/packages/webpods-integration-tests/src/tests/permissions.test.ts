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

  describe('Private streams', () => {
    it('should only allow creator to read private stream', async () => {
      // User1 creates private stream
      client.setAuthToken(user1Token);
      await client.post('/private-read?read=private', 'Secret message');
      
      // User1 can read
      const response1 = await client.get('/private-read');
      expect(response1.status).to.equal(200);
      expect(response1.data.records[0]).to.equal('Secret message');
      
      // User2 cannot read
      client.setAuthToken(user2Token);
      const response2 = await client.get('/private-read');
      expect(response2.status).to.equal(403);
      expect(response2.data.error.code).to.equal('FORBIDDEN');
      
      // Anonymous cannot read
      client.clearAuthToken();
      const response3 = await client.get('/private-read');
      expect(response3.status).to.equal(403);
    });

    it('should only allow creator to write to private stream', async () => {
      // User1 creates private write stream
      client.setAuthToken(user1Token);
      await client.post('/private-write?write=private', 'First message');
      
      // User2 cannot write
      client.setAuthToken(user2Token);
      const response = await client.post('/private-write', 'Attempt to write');
      expect(response.status).to.equal(403);
      expect(response.data.error.code).to.equal('FORBIDDEN');
      
      // User1 can write
      client.setAuthToken(user1Token);
      const response2 = await client.post('/private-write', 'Second message');
      expect(response2.status).to.equal(201);
    });
  });

  describe('Public streams', () => {
    it('should allow anyone to read public stream', async () => {
      // User1 creates public stream
      client.setAuthToken(user1Token);
      await client.post('/public-stream', 'Public message');
      
      // User2 can read
      client.setAuthToken(user2Token);
      const response1 = await client.get('/public-stream');
      expect(response1.status).to.equal(200);
      
      // Anonymous can read
      client.clearAuthToken();
      const response2 = await client.get('/public-stream');
      expect(response2.status).to.equal(200);
    });

    it('should allow any authenticated user to write to public stream', async () => {
      // User1 creates public stream
      client.setAuthToken(user1Token);
      await client.post('/public-write', 'Message 1');
      
      // User2 can write
      client.setAuthToken(user2Token);
      const response = await client.post('/public-write', 'Message 2');
      expect(response.status).to.equal(201);
      
      // Verify both messages exist
      const list = await client.get('/public-write');
      expect(list.data.records).to.have.lengthOf(2);
    });
  });

  describe('Allow/Deny lists', () => {
    it('should support allow lists for reading', async () => {
      client.setAuthToken(user1Token);
      
      // Create allow list stream
      await client.post('/allowed-users', {
        id: 'auth:google:user2',
        read: true,
        write: false
      });
      
      // Create stream with allow list
      await client.post('/restricted?read=/allowed-users', 'Restricted content');
      
      // User2 can read (in allow list)
      client.setAuthToken(user2Token);
      const response1 = await client.get('/restricted');
      expect(response1.status).to.equal(200);
      
      // User1 can read (creator)
      client.setAuthToken(user1Token);
      const response2 = await client.get('/restricted');
      expect(response2.status).to.equal(200);
    });

    it('should support deny lists for writing', async () => {
      client.setAuthToken(user1Token);
      
      // Create deny list stream
      await client.post('/blocked-users', {
        id: 'auth:google:user2',
        read: false,
        write: false
      });
      
      // Create stream with deny list
      await client.post('/moderated?write=~/blocked-users', 'Initial message');
      
      // User2 cannot write (in deny list)
      client.setAuthToken(user2Token);
      const response = await client.post('/moderated', 'Blocked attempt');
      expect(response.status).to.equal(403);
      
      // Update deny list to unblock user2
      client.setAuthToken(user1Token);
      await client.post('/blocked-users', {
        id: 'auth:google:user2',
        read: true,
        write: true
      });
      
      // Now user2 can write
      client.setAuthToken(user2Token);
      const response2 = await client.post('/moderated', 'Now allowed');
      expect(response2.status).to.equal(201);
    });
  });

  describe('Permission updates', () => {
    it('should only allow creator to update permissions', async () => {
      // User1 creates stream
      client.setAuthToken(user1Token);
      await client.post('/perm-update', 'Initial');
      
      // User2 cannot update permissions
      client.setAuthToken(user2Token);
      const response = await client.post('/perm-update?read=private');
      expect(response.status).to.equal(403);
      
      // User1 can update permissions
      client.setAuthToken(user1Token);
      const response2 = await client.post('/perm-update?read=private&write=private');
      expect(response2.status).to.equal(201);
      
      // Verify permissions were updated
      const db = testDb.getDb();
      const stream = await db('stream').where('stream_id', 'perm-update').first();
      expect(stream.read_permission).to.equal('private');
      expect(stream.write_permission).to.equal('private');
    });
  });
});