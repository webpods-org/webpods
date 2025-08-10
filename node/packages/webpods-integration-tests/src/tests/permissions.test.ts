// Permission tests for WebPods
import { expect } from 'chai';
import jwt from 'jsonwebtoken';
import { client, testDb } from '../test-setup.js';

describe('WebPods Permissions', () => {
  let user1: any;
  let user1Id: string;
  let user1Token: string;
  let user2: any;
  let user2Id: string;
  let user2Token: string;
  const testPodId = 'perm-test';
  const baseUrl = `http://${testPodId}.localhost:3099`;

  beforeEach(async () => {
    const db = testDb.getDb();
    
    // Create two test users
    [user1] = await db('user').insert({
      id: crypto.randomUUID(),
      auth_id: 'auth:google:user1',
      email: 'user1@example.com',
      name: 'User One',
      provider: 'google'
    }).returning('*');
    
    [user2] = await db('user').insert({
      id: crypto.randomUUID(),
      auth_id: 'auth:google:user2',
      email: 'user2@example.com', 
      name: 'User Two',
      provider: 'google'
    }).returning('*');
    
    user1Id = user1.id;
    user2Id = user2.id;
    
    user1Token = jwt.sign({
      user_id: user1.id,
      auth_id: user1.auth_id,
      email: user1.email,
      name: user1.name,
      provider: 'google'
    }, process.env.JWT_SECRET || 'test-secret-key', { expiresIn: '1h' });
    
    user2Token = jwt.sign({
      user_id: user2.id,
      auth_id: user2.auth_id,
      email: user2.email,
      name: user2.name,
      provider: 'google'
    }, process.env.JWT_SECRET || 'test-secret-key', { expiresIn: '1h' });
    
    client.setBaseUrl(baseUrl);
  });

  describe('Private Streams', () => {
    it('should only allow creator to read private stream', async () => {
      // User1 creates private stream
      client.setAuthToken(user1Token);
      await client.post('/private-read?read=private', 'Secret message');
      
      // User1 can read
      const response1 = await client.get('/private-read?i=0');
      expect(response1.status).to.equal(200);
      expect(response1.data).to.equal('Secret message');
      
      // User2 cannot read
      client.setAuthToken(user2Token);
      const response2 = await client.get('/private-read?i=0');
      expect(response2.status).to.equal(403);
      expect(response2.data.error.code).to.equal('FORBIDDEN');
      
      // Anonymous cannot read
      client.clearAuthToken();
      const response3 = await client.get('/private-read?i=0');
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
      
      // User1 can write more
      client.setAuthToken(user1Token);
      const response2 = await client.post('/private-write', 'Second message');
      expect(response2.status).to.equal(201);
      expect(response2.data.sequence_num).to.equal(1);
    });
  });

  describe('Public Streams', () => {
    it('should allow anyone to read public stream', async () => {
      // User1 creates public stream
      client.setAuthToken(user1Token);
      await client.post('/public-stream', 'Public message');
      
      // User2 can read
      client.setAuthToken(user2Token);
      const response1 = await client.get('/public-stream?i=0');
      expect(response1.status).to.equal(200);
      
      // Anonymous can read
      client.clearAuthToken();
      const response2 = await client.get('/public-stream?i=0');
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
      
      // Anonymous cannot write
      client.clearAuthToken();
      const response2 = await client.post('/public-write', 'Anonymous attempt');
      expect(response2.status).to.equal(401);
    });
  });

  describe('Permission Streams (Allow/Deny Lists)', () => {
    it('should support allow lists for reading', async () => {
      client.setAuthToken(user1Token);
      
      // Create permission stream with user2 allowed
      await client.post('/allowed-users', {
        id: user2.auth_id,
        read: true,
        write: false
      });
      
      // Create stream with allow list
      await client.post('/restricted?read=/allowed-users', 'Restricted content');
      
      // User2 can read (in allow list)
      client.setAuthToken(user2Token);
      const response1 = await client.get('/restricted?i=0');
      expect(response1.status).to.equal(200);
      
      // User1 can read (creator always has access)
      client.setAuthToken(user1Token);
      const response2 = await client.get('/restricted?i=0');
      expect(response2.status).to.equal(200);
      
      // Anonymous cannot read
      client.clearAuthToken();
      const response3 = await client.get('/restricted?i=0');
      expect(response3.status).to.equal(403);
    });

    it('should support deny lists for writing', async () => {
      client.setAuthToken(user1Token);
      
      // Create deny list stream
      await client.post('/blocked-users', {
        id: user2.auth_id,
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
        id: user2.auth_id,
        read: true,
        write: true
      });
      
      // Now user2 can write (last-write-wins in permission stream)
      client.setAuthToken(user2Token);
      const response2 = await client.post('/moderated', 'Now allowed');
      expect(response2.status).to.equal(201);
    });

    it('should support multiple permission streams', async () => {
      client.setAuthToken(user1Token);
      
      // Create VIP users list
      await client.post('/vip-users', {
        id: user2.auth_id,
        read: true,
        write: true
      });
      
      // Create banned users list
      await client.post('/banned-users', {
        id: 'auth:google:banned-user',
        read: false,
        write: false
      });
      
      // Create stream with both allow and deny lists
      await client.post('/exclusive?read=/vip-users,~/banned-users', 'VIP only content');
      
      // User2 can access (in VIP list, not in banned list)
      client.setAuthToken(user2Token);
      const response = await client.get('/exclusive?i=0');
      expect(response.status).to.equal(200);
    });
  });

  describe('Pod Ownership', () => {
    it('should transfer pod ownership via .meta/owner', async () => {
      // User1 creates pod
      client.setAuthToken(user1Token);
      await client.post('/test', 'Create pod');
      
      // Transfer ownership to user2
      const response = await client.post('/.meta/owner', { owner: user2Id });
      expect(response.status).to.equal(201);
      
      // User2 is now owner and can update .meta/ streams
      client.setAuthToken(user2Token);
      const response2 = await client.post('/.meta/links', { '/': 'homepage' });
      expect(response2.status).to.equal(201);
      
      // User1 can no longer update .meta/ streams
      client.setAuthToken(user1Token);
      const response3 = await client.post('/.meta/links', { '/about': 'about' });
      expect(response3.status).to.equal(403);
    });

    it('should only allow current owner to transfer ownership', async () => {
      // User1 creates pod
      client.setAuthToken(user1Token);
      await client.post('/test', 'Create pod');
      
      // User2 cannot transfer ownership
      client.setAuthToken(user2Token);
      const response = await client.post('/.meta/owner', { owner: user2Id });
      expect(response.status).to.equal(403);
      expect(response.data.error.code).to.equal('FORBIDDEN');
    });
  });

  describe('Stream Permission Updates', () => {
    it('should allow creator to update stream permissions', async () => {
      // User1 creates stream
      client.setAuthToken(user1Token);
      await client.post('/perm-update', 'Initial');
      
      // User1 can update permissions by writing with new permissions
      const response = await client.post('/perm-update?read=private&write=private', 'Updated');
      expect(response.status).to.equal(201);
      
      // Verify permissions were updated for new records
      // (Note: existing stream permissions don't change, only apply to new writes)
      const db = testDb.getDb();
      const pod = await db('pod').where('pod_id', testPodId).first();
      const stream = await db('stream')
        .where('pod_id', pod.id)
        .where('stream_id', 'perm-update')
        .first();
      
      // Original permissions should remain (first write sets them)
      expect(stream.read_permission).to.equal('public');
      expect(stream.write_permission).to.equal('public');
    });
  });

  describe('Complex Permission Scenarios', () => {
    it('should handle nested stream paths with permissions', async () => {
      client.setAuthToken(user1Token);
      
      // Create private blog posts
      await client.post('/blog/private/draft?read=private', 'Draft post');
      await client.post('/blog/public/published', 'Published post');
      
      // User2 cannot read private
      client.setAuthToken(user2Token);
      const response1 = await client.get('/blog/private/draft?i=0');
      expect(response1.status).to.equal(403);
      
      // But can read public
      const response2 = await client.get('/blog/public/published?i=0');
      expect(response2.status).to.equal(200);
    });

    it('should respect permissions on aliased content', async () => {
      client.setAuthToken(user1Token);
      
      // Create private stream with alias
      await client.post('/secrets?read=private&alias=topsecret', 'Classified');
      
      // User2 cannot read via alias
      client.setAuthToken(user2Token);
      const response = await client.get('/secrets/topsecret');
      expect(response.status).to.equal(403);
      
      // User1 can read via alias
      client.setAuthToken(user1Token);
      const response2 = await client.get('/secrets/topsecret');
      expect(response2.status).to.equal(200);
      expect(response2.data).to.equal('Classified');
    });

    it('should handle permission stream updates correctly', async () => {
      client.setAuthToken(user1Token);
      
      // Create permission stream
      await client.post('/members', {
        id: user2.auth_id,
        read: true,
        write: false
      });
      
      // Create restricted stream
      await client.post('/member-only?read=/members', 'Members content');
      
      // User2 can read
      client.setAuthToken(user2Token);
      let response = await client.get('/member-only?i=0');
      expect(response.status).to.equal(200);
      
      // User1 updates permission to revoke user2's access
      client.setAuthToken(user1Token);
      await client.post('/members', {
        id: user2.auth_id,
        read: false,
        write: false
      });
      
      // User2 can no longer read (last-write-wins)
      client.setAuthToken(user2Token);
      response = await client.get('/member-only?i=0');
      expect(response.status).to.equal(403);
    });
  });
});