// Health check tests for WebPods
import { expect } from "chai";
import {
  TestHttpClient,
  createTestUser,
  createTestPod,
} from "webpods-test-utils";
import { testDb } from "../test-setup.js";

describe("WebPods Health Checks", () => {
  let client: TestHttpClient;

  beforeEach(() => {
    client = new TestHttpClient("http://localhost:3000");
    client.setBaseUrl("http://localhost:3000");
  });

  it("should return healthy status", async () => {
    const response = await client.get("/health");

    expect(response.status).to.equal(200);
    expect(response.data).to.have.property("status", "healthy");
    expect(response.data).to.have.property("timestamp");
  });

  it("should verify wildcard subdomain routing works", async () => {
    const uniquePodId = `health-check-${Date.now()}`;
    client.setBaseUrl(`http://${uniquePodId}.localhost:3000`);

    // Create a test user and authenticate
    const db = testDb.getDb();
    const user = await createTestUser(db, {
      provider: "testprovider1",
      providerId: "health-test",
      email: "health@example.com",
      name: "Health Test User",
    });

    // Create the pod
    await createTestPod(db, uniquePodId, user.userId);

    // Get OAuth token
    const token = await client.authenticateViaOAuth(user.userId, [uniquePodId]);

    client.setAuthToken(token);

    // Try to write to a stream on this pod
    const response = await client.post(
      "/health-stream/health",
      "Health check content",
    );

    // Should succeed, proving subdomain routing works
    expect(response.status).to.equal(201);
    expect(response.data).to.have.property("index", 0);

    // Verify pod was created
    const pod = await db.oneOrNone(
      `SELECT * FROM pod WHERE pod_id = $(podId)`,
      { podId: uniquePodId },
    );
    expect(pod).to.exist;
  });
});
