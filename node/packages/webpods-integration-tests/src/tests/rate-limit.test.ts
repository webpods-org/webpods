// Rate limiting tests
import { expect } from 'chai';
import jwt from 'jsonwebtoken';
import { client, testDb } from '../test-setup.js';

describe('Rate Limiting', () => {
  let userId: string;
  let authToken: string;

  beforeEach(async () => {
    const db = testDb.getDb();
    const [user] = await db('`user`').insert({
      auth_id: 'auth:google:ratelimit',
      email: 'ratelimit@example.com',
      name: 'Rate Limit User',
      provider: 'google'
    }).returning('*');
    
    userId = user.id;
    authToken = jwt.sign({
      userId: user.id,
      authId: user.auth_id,
      email: user.email,
      name: user.name,
      provider: 'google'
    }, 'test-secret-key', { expiresIn: '1h' });
    
    client.setAuthToken(authToken);
  });

  it('should track write rate limits in database', async () => {
    // Make a few write requests
    await client.post('/q/rate-test-1', 'Message 1');
    await client.post('/q/rate-test-2', 'Message 2');
    await client.post('/q/rate-test-3', 'Message 3');
    
    // Check rate limit record was created
    const db = testDb.getDb();
    const rateLimit = await db('rate_limit')
      .where('user_id', userId)
      .where('action', 'write')
      .first();
    
    expect(rateLimit).to.exist;
    expect(rateLimit.count).to.equal(3);
    expect(rateLimit.window_end).to.be.instanceOf(Date);
  });

  it('should track read rate limits separately', async () => {
    // Create a public queue
    await client.post('/q/public-read-test', 'Content');
    
    // Make read requests
    await client.get('/q/public-read-test');
    await client.get('/q/public-read-test');
    
    // Check rate limit records
    const db = testDb.getDb();
    const writeLimit = await db('rate_limit')
      .where('user_id', userId)
      .where('action', 'write')
      .first();
    
    const readLimit = await db('rate_limit')
      .where('user_id', userId)
      .where('action', 'read')
      .first();
    
    expect(writeLimit.count).to.equal(1); // One write
    expect(readLimit.count).to.equal(2); // Two reads
  });

  it('should clean up old rate limit windows', async () => {
    const db = testDb.getDb();
    
    // Insert an old rate limit window
    const oldWindow = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago
    await db('rate_limit').insert({
      user_id: userId,
      action: 'write',
      count: 100,
      window_start: new Date(oldWindow.getTime() - 60 * 60 * 1000),
      window_end: oldWindow
    });
    
    // Make a new request (should clean up old window)
    await client.post('/q/cleanup-test', 'New message');
    
    // Check that old window is gone
    const oldLimits = await db('rate_limit')
      .where('window_end', '<', new Date(Date.now() - 60 * 60 * 1000))
      .count('* as count');
    
    expect(parseInt(oldLimits[0]?.count as string)).to.equal(0);
  });

  // Note: Actually hitting rate limits would require many requests,
  // which we skip in tests for performance reasons.
  // The limit is set to 2000 per hour in production.
});