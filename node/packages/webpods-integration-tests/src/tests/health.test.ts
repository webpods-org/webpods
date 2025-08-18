// Health check tests for WebPods
import { expect } from "chai";
import { TestHttpClient } from "webpods-test-utils";
import { testDb } from "../test-setup.js";

describe("WebPods Health Checks", () => {
  let client: TestHttpClient;

  beforeEach(() => {
    client = new TestHttpClient("http://localhost:3099");
    client.setBaseUrl("http://localhost:3099");
  });

  it("should return healthy status", async () => {
    const response = await client.get("/health");

    expect(response.status).to.equal(200);
    expect(response.data).to.have.property("status", "healthy");
    expect(response.data).to.have.property("timestamp");
  });

  it("should verify wildcard subdomain routing works", async () => {
    const uniquePodId = `health-check-${Date.now()}`;
    client.setBaseUrl(`http://${uniquePodId}.localhost:3099`);

    // Create a test user and authenticate
    const db = testDb.getDb();
    const [user] = await db("user")
      .insert({
        id: crypto.randomUUID(),
        auth_id: "auth:provider:health-test",
        email: "health@example.com",
        name: "Health Test User",
        provider: "testprovider1",
      })
      .returning("*");

    // Generate pod-specific token for the unique pod
    const token = client.generatePodToken(
      {
        user_id: user.id,
        auth_id: user.auth_id,
        email: user.email,
        name: user.name,
        provider: "testprovider1",
      },
      uniquePodId,
    );

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
    const pod = await db("pod").where("pod_id", uniquePodId).first();
    expect(pod).to.exist;
  });
});
