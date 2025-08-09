// Test setup for WebPods integration tests
import { TestDatabase, TestServer, TestHttpClient, testLogger } from 'webpods-test-utils';

// Test configuration
export const testDb = new TestDatabase({ dbName: 'webpods_test', logger: testLogger });
export const testServer = new TestServer({ port: 3099, dbName: 'webpods_test', logger: testLogger });
export const client = new TestHttpClient(`http://localhost:3099`);

// Setup before all tests
before(async function() {
  this.timeout(60000); // 60 seconds for setup
  
  console.log('🚀 Starting WebPods integration test setup...');
  
  // Setup database
  await testDb.setup();
  
  // Start the real WebPods server
  await testServer.start();
  
  console.log('✅ WebPods integration test setup complete');
});

// Cleanup after each test
afterEach(async function() {
  await testDb.truncateAllTables();
  client.clearAuthToken();
});

// Teardown after all tests
after(async function() {
  this.timeout(30000); // 30 seconds for teardown
  
  console.log('🛑 Shutting down WebPods integration tests...');
  
  // Stop server
  await testServer.stop();
  
  // Cleanup database
  await testDb.cleanup();
  
  console.log('✅ WebPods integration test teardown complete');
});