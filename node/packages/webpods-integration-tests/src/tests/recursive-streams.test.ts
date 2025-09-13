// Recursive stream queries tests for WebPods
import { expect } from "chai";
import {
  TestHttpClient,
  createTestUser,
  createTestPod,
  clearAllCache,
} from "webpods-test-utils";
import { testDb } from "../test-setup.js";

describe("Recursive Stream Queries", () => {
  let client: TestHttpClient;
  let userId: string;
  let authToken: string;
  const testPodId = "test-recursive-pod";
  const baseUrl = `http://${testPodId}.localhost:3000`;

  beforeEach(async () => {
    await clearAllCache();
    client = new TestHttpClient("http://localhost:3000");
    // Create a test user and auth token
    const db = testDb.getDb();
    const user = await createTestUser(db, {
      provider: "test-auth-provider-1",
      providerId: "recursive-test-user",
      email: "recursive@example.com",
      name: "Recursive Test User",
    });

    userId = user.userId;

    // Create the test pod
    await createTestPod(db, testPodId, userId);

    // Get OAuth token via Hydra
    authToken = await client.authenticateViaOAuth(userId, [testPodId]);

    client.setBaseUrl(baseUrl);
    client.setAuthToken(authToken);
  });

  afterEach(async () => {
    await clearAllCache();
  });

  describe("GET /{stream}?recursive=true", () => {
    it("should return records from exact stream and nested streams", async () => {
      // Create streams with hierarchical structure
      // /api
      // /api/v1
      // /api/v1/users
      // /api/v2
      // /other

      // Write records to different streams
      await client.post("/api/record1", { data: "api root record" });
      await client.post("/api/v1/record1", { data: "api v1 record" });
      await client.post("/api/v1/users/record1", {
        data: "api v1 users record",
      });
      await client.post("/api/v2/record1", { data: "api v2 record" });
      await client.post("/other/record1", { data: "other record" });

      // Query /api recursively - should get all /api* records
      const response = await client.get("/api?recursive=true");
      expect(response.status).to.equal(200);
      expect(response.data.records).to.have.lengthOf(4);
      expect(response.data.total).to.equal(4);

      // Verify we got the right records
      const recordData = response.data.records.map((r: any) => r.content.data);
      expect(recordData).to.include.members([
        "api root record",
        "api v1 record",
        "api v1 users record",
        "api v2 record",
      ]);
      expect(recordData).to.not.include("other record");
    });

    it("should return records from nested path /api/v1 recursively", async () => {
      // Create the same structure as above
      await client.post("/api/record1", { data: "api root record" });
      await client.post("/api/v1/record1", { data: "api v1 record" });
      await client.post("/api/v1/users/record1", {
        data: "api v1 users record",
      });
      await client.post("/api/v2/record1", { data: "api v2 record" });

      // Query /api/v1 recursively - should only get /api/v1 and /api/v1/users
      const response = await client.get("/api/v1?recursive=true");
      expect(response.status).to.equal(200);
      expect(response.data.records).to.have.lengthOf(2);
      expect(response.data.total).to.equal(2);

      const recordData = response.data.records.map((r: any) => r.content.data);
      expect(recordData).to.include.members([
        "api v1 record",
        "api v1 users record",
      ]);
      expect(recordData).to.not.include("api root record");
      expect(recordData).to.not.include("api v2 record");
    });

    it("should return empty when no matching streams exist", async () => {
      const response = await client.get("/nonexistent?recursive=true");
      expect(response.status).to.equal(200);
      expect(response.data.records).to.have.lengthOf(0);
      expect(response.data.total).to.equal(0);
      expect(response.data.hasMore).to.be.false;
    });

    it("should respect pagination with recursive queries", async () => {
      // Create multiple records
      for (let i = 0; i < 5; i++) {
        await client.post(`/test/record${i}`, { data: `test record ${i}` });
      }

      for (let i = 0; i < 5; i++) {
        await client.post(`/test/nested/record${i}`, {
          data: `nested record ${i}`,
        });
      }

      // Query with limit
      const response = await client.get("/test?recursive=true&limit=3");
      expect(response.status).to.equal(200);
      expect(response.data.records).to.have.lengthOf(3);
      expect(response.data.total).to.equal(10);
      expect(response.data.hasMore).to.be.true;
    });

    it("should work with negative after parameter", async () => {
      // Create records
      for (let i = 0; i < 3; i++) {
        await client.post(`/data/record${i}`, { data: `data record ${i}` });
      }

      for (let i = 0; i < 2; i++) {
        await client.post(`/data/sub/record${i}`, { data: `sub record ${i}` });
      }

      // Get last 3 records
      const response = await client.get("/data?recursive=true&after=-3");
      expect(response.status).to.equal(200);
      expect(response.data.records).to.have.lengthOf(3);
      expect(response.data.total).to.equal(5);
    });

    it("should respect stream permissions when querying recursively", async () => {
      // Create public stream
      await client.post("/public/record1", { data: "public record" });

      // Create private stream
      await client.post("/public/private/record1?access=private", {
        data: "private record",
      });

      // Query without auth - should only see public
      const unauthClient = new TestHttpClient(baseUrl);
      const response = await unauthClient.get("/public?recursive=true");
      expect(response.status).to.equal(200);
      expect(response.data.records).to.have.lengthOf(1);
      const recordData = response.data.records.map((r: any) => r.content.data);
      expect(recordData).to.include("public record");
      expect(recordData).to.not.include("private record");

      // Query with auth - should see both
      const authResponse = await client.get("/public?recursive=true");
      expect(authResponse.status).to.equal(200);
      expect(authResponse.data.records).to.have.lengthOf(2);
      const authRecordData = authResponse.data.records.map(
        (r: any) => r.content.data,
      );
      expect(authRecordData).to.include.members([
        "public record",
        "private record",
      ]);
    });

    it("should not match sibling streams with similar names", async () => {
      // Create streams that should not match
      await client.post("/api/record1", { data: "api record" });
      await client.post("/api2/record1", { data: "api2 record" });
      await client.post("/api_other/record1", { data: "api_other record" });

      // Query /api recursively
      const response = await client.get("/api?recursive=true");
      expect(response.status).to.equal(200);
      expect(response.data.records).to.have.lengthOf(1);
      const recordData = response.data.records.map((r: any) => r.content.data);
      expect(recordData).to.include("api record");
      expect(recordData).to.not.include("api2 record");
      expect(recordData).to.not.include("api_other record");
    });

    it("should support combining recursive with unique parameter", async () => {
      // Add some duplicate named records across nested streams
      await client.post("/test/config.json", { data: "test config v1" });
      await client.post("/test/config.json", { data: "test config v2" });
      await client.post("/test/nested/config.json", { data: "nested config" });
      await client.post("/test/nested/other.txt", { data: "other file" });

      const response = await client.get("/test?recursive=true&unique=true");
      expect(response.status).to.equal(200);

      // Should get unique records from all nested streams
      const records = response.data.records;
      expect(records).to.be.an("array");
      expect(records.length).to.be.greaterThan(0);

      // Should have 3 records: config.json from /test, config.json from /test/nested, and other.txt
      expect(records.length).to.equal(3);

      // Should have 2 config.json records (one from each stream)
      const configs = records.filter((r: any) => r.name === "config.json");
      expect(configs.length).to.equal(2);

      // Should have other.txt from nested stream
      const otherFile = records.find((r: any) => r.name === "other.txt");
      expect(otherFile).to.exist;
    });

    it("should handle deep nesting correctly", async () => {
      // Create deeply nested structure
      await client.post("/a/record1", { data: "level 1" });
      await client.post("/a/b/record1", { data: "level 2" });
      await client.post("/a/b/c/record1", { data: "level 3" });
      await client.post("/a/b/c/d/record1", { data: "level 4" });

      // Query from middle level
      const response = await client.get("/a/b?recursive=true");
      expect(response.status).to.equal(200);
      expect(response.data.records).to.have.lengthOf(3);
      const recordData = response.data.records.map((r: any) => r.content.data);
      expect(recordData).to.include.members(["level 2", "level 3", "level 4"]);
      expect(recordData).to.not.include("level 1");
    });

    it("should sort records by creation time across streams", async () => {
      // Create records with small delays to ensure different timestamps
      await client.post("/time/stream1/first", { data: "first" });

      // Small delay
      await new Promise((resolve) => setTimeout(resolve, 10));

      await client.post("/time/stream2/second", { data: "second" });

      await new Promise((resolve) => setTimeout(resolve, 10));

      await client.post("/time/third", { data: "third" });

      const response = await client.get("/time?recursive=true");
      expect(response.status).to.equal(200);
      expect(response.data.records).to.have.lengthOf(3);

      // Verify chronological order
      const recordData = response.data.records.map((r: any) => r.content.data);
      expect(recordData[0]).to.equal("first");
      expect(recordData[1]).to.equal("second");
      expect(recordData[2]).to.equal("third");
    });
  });
});
