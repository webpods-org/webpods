// Stream operations tests for WebPods
import { expect } from "chai";
import {
  TestHttpClient,
  createTestUser,
  createTestPod,
  clearAllCache,
} from "webpods-test-utils";
import { testDb } from "../test-setup.js";

describe("WebPods Stream Operations", () => {
  let client: TestHttpClient;
  let userId: string;
  let authToken: string;
  const testPodId = "test-pod";
  const baseUrl = `http://${testPodId}.localhost:3000`;

  beforeEach(async () => {
    await clearAllCache();
    client = new TestHttpClient("http://localhost:3000");
    // Create a test user and auth token
    const db = testDb.getDb();
    const user = await createTestUser(db, {
      provider: "test-auth-provider-1",
      providerId: "123456",
      email: "test@example.com",
      name: "Test User",
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

  describe("Pod and Stream Creation", () => {
    it("should support both explicit stream creation and auto-create on first write", async () => {
      // Test 1: Auto-create on first write
      const response = await client.post(
        "/my-first-stream/hello",
        "Hello WebPods!",
      );
      expect(response.status).to.equal(201);
      expect(response.data).to.have.property("index", 0);
      expect(response.data).to.have.property("content", "Hello WebPods!");

      // Test 2: Explicit stream creation with POST and empty body
      const createResponse = await client.createStream("my-second-stream");
      expect(createResponse.status).to.equal(201);
      expect(createResponse.data).to.have.property("success", true);

      // Now write to the explicitly created stream
      const writeResponse = await client.post(
        "/my-second-stream/hello",
        "Hello from second stream!",
      );
      expect(writeResponse.status).to.equal(201);
      expect(writeResponse.data).to.have.property("index", 0);
      expect(writeResponse.data).to.have.property(
        "content",
        "Hello from second stream!",
      );

      // Verify stream exists in database
      const db = testDb.getDb();
      const stream = await db.oneOrNone(
        `SELECT * FROM stream WHERE pod_name = $(pod_name) AND name = $(streamName) AND parent_id IS NULL`,
        { pod_name: testPodId, streamName: "my-first-stream" },
      );
      expect(stream).to.exist;
      expect(stream.user_id).to.equal(userId);
    });

    it("should support nested stream paths", async () => {
      // Create nested stream first
      const createResponse = await client.createStream("blog/posts/2024");
      expect(createResponse.status).to.equal(201);

      const response = await client.post("/blog/posts/2024/january", {
        content: "January blog post",
      });

      expect(response.status).to.equal(201);

      // Verify nested path stream hierarchy exists
      const db = testDb.getDb();

      // blog stream (root level)
      const blogStream = await db.oneOrNone(
        `SELECT * FROM stream WHERE pod_name = $(pod_name) AND name = 'blog' AND parent_id IS NULL`,
        { pod_name: testPodId },
      );
      expect(blogStream).to.exist;

      // posts stream (child of blog)
      const postsStream = await db.oneOrNone(
        `SELECT * FROM stream WHERE pod_name = $(pod_name) AND name = 'posts' AND parent_id = $(parent_id)`,
        { pod_name: testPodId, parent_id: blogStream.id },
      );
      expect(postsStream).to.exist;

      // 2024 stream (child of posts)
      const yearStream = await db.oneOrNone(
        `SELECT * FROM stream WHERE pod_name = $(pod_name) AND name = '2024' AND parent_id = $(parent_id)`,
        { pod_name: testPodId, parent_id: postsStream.id },
      );
      expect(yearStream).to.exist;

      // Verify the record was created with name 'january'
      const record = await db.oneOrNone(
        `SELECT * FROM record WHERE stream_id = $(stream_id) AND name = $(name)`,
        { stream_id: yearStream.id, name: "january" },
      );
      expect(record).to.exist;
    });

    it("should set custom permissions on stream creation", async () => {
      // Create stream with private permission
      const createResponse = await client.createStream(
        "private-stream",
        "private",
      );
      expect(createResponse.status).to.equal(201);
      expect(createResponse.data).to.have.property("success", true);

      const response = await client.post(
        "/private-stream/secret",
        "Secret data",
      );

      expect(response.status).to.equal(201);

      const db = testDb.getDb();
      const stream = await db.oneOrNone(
        `SELECT * FROM stream WHERE pod_name = $(pod_name) AND name = $(streamName) AND parent_id IS NULL`,
        { pod_name: testPodId, streamName: "private-stream" },
      );
      expect(stream).to.exist;
      expect(stream.access_permission).to.equal("private");
    });
  });

  describe("Writing Records", () => {
    beforeEach(async () => {
      // Pre-create a stream explicitly
      await client.createStream("test-stream");
      await client.post("/test-stream/initial", "Initial content");
    });

    it("should write string content", async () => {
      const response = await client.post(
        "/test-stream/text",
        "Plain text message",
        {
          headers: { "Content-Type": "text/plain" },
        },
      );
      expect(response.status).to.equal(201);
      expect(response.data.index).to.equal(1); // Second write, so index is 1
      expect(response.data.content).to.equal("Plain text message");
      expect(response.data.contentType).to.equal("text/plain");
    });

    it("should write JSON content", async () => {
      const data = { message: "JSON data", count: 42 };
      const response = await client.post("/test-stream/json", data);

      expect(response.status).to.equal(201);
      expect(response.data.content).to.deep.equal(data);
      expect(response.data.contentType).to.equal("application/json");
    });

    it("should respect Content-Type header", async () => {
      const response = await client.post("/test-stream/html", "<h1>HTML</h1>", {
        headers: { "Content-Type": "text/html" },
      });

      expect(response.status).to.equal(201);
      expect(response.data.contentType).to.equal("text/html");
    });

    it("should maintain hash chain", async () => {
      await client.createStream("hash-test");
      const response1 = await client.post("/hash-test/first", "First");
      const response2 = await client.post("/hash-test/second", "Second");
      const response3 = await client.post("/hash-test/third", "Third");

      expect(response1.data.previousHash).to.be.null;
      expect(response2.data.previousHash).to.equal(response1.data.hash);
      expect(response3.data.previousHash).to.equal(response2.data.hash);

      // Verify hash format
      expect(response1.data.hash).to.match(/^sha256:[a-f0-9]{64}$/);

      // Verify contentHash exists and is different from record hash
      expect(response1.data.contentHash).to.exist;
      expect(response1.data.contentHash).to.match(/^sha256:[a-f0-9]{64}$/);
      expect(response1.data.contentHash).to.not.equal(response1.data.hash);

      // Content hash should be the same for identical content
      const duplicate = await client.post("/hash-test/duplicate", "First");
      expect(duplicate.data.contentHash).to.equal(response1.data.contentHash);
      // But record hash should be different (different position in chain)
      expect(duplicate.data.hash).to.not.equal(response1.data.hash);
    });

    it("should support names (including numeric)", async () => {
      // String name
      const response1 = await client.post(
        "/test-stream/my-post",
        "Content with name",
      );
      expect(response1.status).to.equal(201);
      expect(response1.data.name).to.equal("my-post");

      // Numeric name (allowed now!)
      const response2 = await client.post(
        "/test-stream/2024",
        "Year 2024 content",
      );
      expect(response2.status).to.equal(201);
      expect(response2.data.name).to.equal("2024");

      // Mixed name
      const response3 = await client.post(
        "/test-stream/post-123",
        "Mixed name",
      );
      expect(response3.status).to.equal(201);
      expect(response3.data.name).to.equal("post-123");
    });

    it("should allow duplicate names (last one wins)", async () => {
      const response1 = await client.post("/test-stream/duplicate", "First");
      expect(response1.status).to.equal(201);

      const response2 = await client.post("/test-stream/duplicate", "Second");
      expect(response2.status).to.equal(201);

      // When getting by name, should return the latest
      const getResponse = await client.get("/test-stream/duplicate");
      expect(getResponse.status).to.equal(200);
      expect(getResponse.data).to.equal("Second");
    });
  });

  describe("Reading Records", () => {
    beforeEach(async () => {
      // Create stream with test data
      await client.createStream("read-test");
      await client.post("/read-test/first", "First");
      await client.post("/read-test/second", { data: "Second" });
      await client.post("/read-test/third", "Third");
      await client.post("/read-test/my-name", "Named");
      await client.post("/read-test/2024", "Year 2024");
    });

    it("should get record by positive index", async () => {
      const response = await client.get("/read-test?i=0");
      expect(response.status).to.equal(200);
      expect(response.data).to.equal("First");

      const response2 = await client.get("/read-test?i=2");
      expect(response2.status).to.equal(200);
      expect(response2.data).to.equal("Third");
    });

    it("should get record by negative index", async () => {
      const response = await client.get("/read-test?i=-1");
      expect(response.status).to.equal(200);
      expect(response.data).to.equal("Year 2024");

      const response2 = await client.get("/read-test?i=-5");
      expect(response2.status).to.equal(200);
      expect(response2.data).to.equal("First");
    });

    it("should get range of records", async () => {
      const response = await client.get("/read-test?i=0:3");
      expect(response.status).to.equal(200);
      expect(response.data.records).to.have.lengthOf(3);
      expect(response.data.records[0].content).to.equal("First");
      expect(response.data.records[2].content).to.equal("Third");
    });

    it("should get record by string name", async () => {
      const response = await client.get("/read-test/my-name");
      expect(response.status).to.equal(200);
      expect(response.data).to.equal("Named");
    });

    it("should get record by numeric name", async () => {
      const response = await client.get("/read-test/2024");
      expect(response.status).to.equal(200);
      expect(response.data).to.equal("Year 2024");
    });

    it("should list all records with pagination", async () => {
      const response = await client.get("/read-test?limit=2");
      expect(response.status).to.equal(200);
      expect(response.data.records).to.have.lengthOf(2);
      expect(response.data.hasMore).to.be.true;
      expect(response.data.nextIndex).to.equal(1);

      // Get next page
      const page2 = await client.get(
        `/read-test?limit=2&after=${response.data.nextIndex}`,
      );
      expect(page2.data.records).to.have.lengthOf(2);
    });

    it("should return raw content with metadata in headers", async () => {
      const response = await client.get("/read-test?i=0");
      // Express adds charset, so check if content-type starts with expected value
      expect(response.headers["content-type"]).to.include("text/plain");
      expect(response.headers["x-content-hash"]).to.exist;
      expect(response.headers["x-hash"]).to.exist;
      expect(response.headers["x-author"]).to.equal(userId);
      expect(response.headers["x-timestamp"]).to.exist;
      expect(response.data).to.equal("First");
    });

    it("should support negative 'after' parameter for pagination", async () => {
      // We have 5 records in read-test: first, second, third, my-name, 2024
      // Using after=-3 should skip all but the last 3 records
      const response = await client.get("/read-test?after=-3");
      expect(response.status).to.equal(200);
      expect(response.data.records).to.have.lengthOf(3);

      // Should get the last 3 records (indices 2, 3, 4)
      expect(response.data.records[0].content).to.equal("Third");
      expect(response.data.records[1].content).to.equal("Named");
      expect(response.data.records[2].content).to.equal("Year 2024");
    });

    it("should handle negative 'after' when total < abs(after)", async () => {
      // We have 5 records, after=-10 should return all records
      const response = await client.get("/read-test?after=-10");
      expect(response.status).to.equal(200);
      expect(response.data.records).to.have.lengthOf(5);

      // Should get all records from the beginning
      expect(response.data.records[0].content).to.equal("First");
      expect(response.data.records[4].content).to.equal("Year 2024");
    });

    it("should enforce maximum record limit from config", async () => {
      // Create stream first
      await client.createStream("limit-test");
      // Create more records than the max limit (config has maxRecordLimit: 10)
      for (let i = 0; i < 15; i++) {
        await client.post(`/limit-test/record${i}`, `Content ${i}`);
      }

      // Request 20 records (more than max)
      const response = await client.get("/limit-test?limit=20");
      expect(response.status).to.equal(200);
      // Should be capped at 10 (the maxRecordLimit from test config)
      expect(response.data.records).to.have.lengthOf(10);

      // Requesting exactly the max should work
      const response2 = await client.get("/limit-test?limit=10");
      expect(response2.status).to.equal(200);
      expect(response2.data.records).to.have.lengthOf(10);

      // Requesting less than max should work normally
      const response3 = await client.get("/limit-test?limit=5");
      expect(response3.status).to.equal(200);
      expect(response3.data.records).to.have.lengthOf(5);
    });
  });

  describe("System Streams (.config/)", () => {
    it("should have .config/owner stream already created", async () => {
      // The .config/owner stream is created when the pod is created
      // in the beforeEach hook
      const db = testDb.getDb();
      const pod = await db.oneOrNone(
        `SELECT * FROM pod WHERE name = $(podId)`,
        { podId: testPodId },
      );

      // Get .config stream
      const configStream = await db.oneOrNone(
        `SELECT * FROM stream WHERE pod_name = $(pod_name) AND name = '.config' AND parent_id IS NULL`,
        { pod_name: pod.name },
      );
      expect(configStream).to.exist;

      // Get owner stream (child of .config)
      const ownerStream = await db.oneOrNone(
        `SELECT * FROM stream WHERE parent_id = $(parent_id) AND name = 'owner'`,
        { parent_id: configStream.id },
      );

      expect(ownerStream).to.exist;
      expect(ownerStream.access_permission).to.equal("private");

      // Check owner record
      const ownerRecord = await db.oneOrNone(
        `SELECT * FROM record WHERE stream_id = $(stream_id) ORDER BY index ASC LIMIT 1`,
        { stream_id: ownerStream.id },
      );
      const content = JSON.parse(ownerRecord.content);
      expect(content.userId).to.equal(userId);
    });

    it("should list streams via .config/api/streams", async () => {
      // Create some streams explicitly
      await client.createStream("stream1");
      await client.createStream("stream2");
      await client.createStream("nested/stream3");

      // Write to the streams
      await client.post("/stream1/content1", "Content 1");
      await client.post("/stream2/content2", "Content 2");
      await client.post("/nested/stream3/content3", "Content 3");

      const response = await client.get("/.config/api/streams");
      expect(response.status).to.equal(200);
      expect(response.data.pod).to.equal(testPodId);
      expect(response.data.streams).to.be.an("array");

      expect(response.data.streams.map((s: any) => s.path)).to.include.members([
        "/stream1",
        "/stream2",
        "/nested/stream3",
        "/.config/owner",
      ]);
    });

    it("should update .config/routing for URL routing", async () => {
      // Create stream first
      await client.createStream("homepage");
      await client.post("/homepage/index", "<h1>Welcome</h1>", {
        headers: { "Content-Type": "text/html" },
      });

      const links = {
        "/": "homepage?i=-1",
        "/about": "pages/about",
        "/blog": "blog?i=-10:-1",
      };

      const response = await client.post("/.config/routing/routes", links);
      expect(response.status).to.equal(201);

      // Verify links work
      const rootResponse = await client.get("/");
      expect(rootResponse.status).to.equal(200);
      expect(rootResponse.data).to.equal("<h1>Welcome</h1>");
    });

    it("should only allow owner to write to .config/ streams", async () => {
      // Create second user
      const db = testDb.getDb();
      const user2 = await createTestUser(db, {
        provider: "test-auth-provider-1",
        providerId: "789",
        email: "other@example.com",
        name: "Other User",
      });

      const token2 = await client.authenticateViaOAuth(user2.userId, [
        testPodId,
      ]);

      // Stream already exists from beforeEach

      // Try to update .config/owner as second user
      client.setAuthToken(token2);
      const response = await client.post("/.config/owner", {
        userId: user2.userId,
      });

      expect(response.status).to.equal(403);
      expect(response.data.error.code).to.equal("FORBIDDEN");
    });
  });

  describe("Stream Deletion", () => {
    it("should delete stream and all records", async () => {
      await client.createStream("delete-me");
      await client.post("/delete-me/msg1", "Message 1");
      await client.post("/delete-me/msg2", "Message 2");

      const response = await client.delete("/delete-me");
      expect(response.status).to.equal(204);

      // Verify stream is gone
      const getResponse = await client.get("/delete-me");
      expect(getResponse.status).to.equal(404);
    });

    it("should prevent deletion of system streams", async () => {
      // System streams already exist from pod creation

      const response = await client.delete("/.config/owner");
      expect(response.status).to.equal(403);
      expect(response.data.error.code).to.equal("FORBIDDEN");
    });

    it("should only allow creator to delete stream", async () => {
      await client.post("/my-stream/content", "Content");

      // Create second user and try to delete
      const db = testDb.getDb();
      const user2 = await createTestUser(db, {
        provider: "test-auth-provider-1",
        providerId: "999",
        email: "other@example.com",
        name: "Other User",
      });

      const token2 = await client.authenticateViaOAuth(user2.userId, [
        testPodId,
      ]);

      client.setAuthToken(token2);
      const response = await client.delete("/my-stream");
      expect(response.status).to.equal(403);
    });
  });

  describe("Content Types and Serving", () => {
    it("should serve HTML directly with correct content type", async () => {
      await client.createStream("page");
      const html = "<html><body><h1>Hello</h1></body></html>";
      await client.post("/page/index", html, {
        headers: { "Content-Type": "text/html" },
      });

      const response = await client.get("/page/index");
      expect(response.status).to.equal(200);
      expect(response.headers["content-type"]).to.include("text/html");
      expect(response.data).to.equal(html);
    });

    it("should serve CSS with correct content type", async () => {
      await client.createStream("assets/styles");
      const css = "body { margin: 0; }";
      await client.post("/assets/styles/main.css", css, {
        headers: { "Content-Type": "text/css" },
      });

      const response = await client.get("/assets/styles/main.css");
      expect(response.headers["content-type"]).to.include("text/css");
      expect(response.data).to.equal(css);
    });

    it("should serve JSON with correct content type", async () => {
      await client.createStream("api");
      const data = { api: "response", version: 1 };
      await client.post("/api/data", data);

      const response = await client.get("/api/data");
      expect(response.headers["content-type"]).to.include("application/json");
      expect(response.data).to.deep.equal(data);
    });
  });
});
