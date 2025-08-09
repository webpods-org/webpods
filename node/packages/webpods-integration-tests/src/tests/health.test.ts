// Health check tests
import { expect } from 'chai';
import { client } from '../test-setup.js';

describe('Health Check', () => {
  it('should return healthy status', async () => {
    const response = await client.get('/health');
    
    expect(response.status).to.equal(200);
    expect(response.data).to.have.property('status', 'healthy');
    expect(response.data).to.have.property('timestamp');
    expect(response.data).to.have.property('environment', 'test');
    expect(response.data).to.have.property('services');
    expect(response.data.services).to.have.property('database', 'connected');
  });
});