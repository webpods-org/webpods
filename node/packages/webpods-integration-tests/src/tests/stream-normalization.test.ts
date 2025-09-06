import { expect } from "chai";
import {
  TestHttpClient,
  createTestUser,
  createTestPod,
} from "webpods-test-utils";
import { testDb } from "../test-setup.js";

describe("Stream Name Normalization", function () {
  this.timeout(5 * 60 * 1000); // 5 minute timeout

  let client: TestHttpClient;
  let userId: string;
  let userToken: string;
  const testPodId = `stream-norm-${Date.now()}`;
  const baseUrl = `http://${testPodId}.localhost:3000`;

  beforeEach(async () => {
    const db = testDb.getDb();
    client = new TestHttpClient("http://localhost:3000");

    // Create test user
    const user = await createTestUser(db, {
      provider: "test-auth-provider-2",
      providerId: "stream-norm-user",
      email: "stream-norm@test.com",
      name: "Stream Norm User",
    });
    userId = user.userId;

    // Create test pod
    await createTestPod(db, testPodId, userId);

    // Get OAuth token
    userToken = await client.authenticateViaOAuth(userId, [testPodId]);

    // Set base URL and auth
    client.setBaseUrl(baseUrl);
    client.setAuthToken(userToken);
  });

  describe("Stream creation normalization", () => {
    it("should normalize stream names without leading slash", async () => {
      // Create stream without leading slash
      const response = await client.post("/blog/posts/first", "Test content");
      expect(response.status).to.equal(201);

      // Verify in database that it's stored with leading slash
      const db = testDb.getDb();
      const stream = await db.oneOrNone(
        `SELECT * FROM stream WHERE pod_name = $(pod_name) AND name = $(name)`,
        { pod_name: testPodId, name: "/blog/posts" },
      );
      expect(stream).to.exist;
      expect(stream.name).to.equal("/blog/posts");
    });

    it("should keep stream names with leading slash unchanged", async () => {
      // Create stream with leading slash (using explicit creation)
      // Note: client adds the leading slash, so we pass without it
      const response = await client.createStream("projects/webapp");
      expect(response.status).to.equal(201);

      // Verify it's stored with the leading slash
      const db = testDb.getDb();
      const stream = await db.oneOrNone(
        `SELECT * FROM stream WHERE pod_name = $(pod_name) AND name = $(name)`,
        { pod_name: testPodId, name: "/projects/webapp" },
      );
      expect(stream).to.exist;
      expect(stream.name).to.equal("/projects/webapp");
    });

    it("should handle nested paths correctly", async () => {
      // Create deeply nested stream
      await client.post("/api/v1/users/profiles/data", "Profile data");

      const db = testDb.getDb();
      const stream = await db.oneOrNone(
        `SELECT * FROM stream WHERE pod_name = $(pod_name) AND name = $(name)`,
        { pod_name: testPodId, name: "/api/v1/users/profiles" },
      );
      expect(stream).to.exist;
      expect(stream.name).to.equal("/api/v1/users/profiles");
    });

    it("should handle root stream (/) correctly", async () => {
      // Write to root
      const response = await client.post("/root-record", "Root content");
      expect(response.status).to.equal(201);

      const db = testDb.getDb();
      // First check what streams exist
      const allStreams = await db.manyOrNone(
        `SELECT * FROM stream WHERE pod_name = $(pod_name)`,
        { pod_name: testPodId },
      );
      console.log(
        "All streams for pod:",
        allStreams.map((s) => s.name),
      );

      const stream = await db.oneOrNone(
        `SELECT * FROM stream WHERE pod_name = $(pod_name) AND name = $(name)`,
        { pod_name: testPodId, name: "/" },
      );
      expect(stream).to.exist;
      expect(stream.name).to.equal("/");
    });
  });

  describe("Stream query normalization", () => {
    it("should find stream regardless of leading slash in query", async () => {
      // Create a stream
      await client.post("/query-test/record1", "Content 1");

      // Query without leading slash
      const response1 = await client.get("/query-test");
      expect(response1.status).to.equal(200);
      expect(response1.data.records).to.have.lengthOf(1);

      // Query with leading slash (should work the same)
      // Note: In URL, leading slash is always there, so this tests internal normalization
      const response2 = await client.get("/query-test?limit=10");
      expect(response2.status).to.equal(200);
      expect(response2.data.records).to.have.lengthOf(1);
    });

    it("should handle permission stream references correctly", async () => {
      // Create permission stream
      await client.createStream("team-permissions");

      // Grant permission
      await client.post(
        "/team-permissions/user-123",
        JSON.stringify({
          id: "user-123",
          read: true,
          write: true,
        }),
        {
          headers: { "Content-Type": "application/json" },
        },
      );

      // Create stream with permission reference (using slash prefix)
      const response = await client.post(
        "/restricted-data?access=/team-permissions",
        "",
        {
          headers: { "Content-Type": "application/json" },
        },
      );
      expect(response.status).to.equal(201);

      // Verify the stream was created with correct permission
      const db = testDb.getDb();
      const stream = await db.oneOrNone(
        `SELECT * FROM stream WHERE pod_name = $(pod_name) AND name = $(name)`,
        { pod_name: testPodId, name: "/restricted-data" },
      );
      expect(stream).to.exist;
      expect(stream.access_permission).to.equal("/team-permissions");
    });
  });

  describe("Record operations with normalized streams", () => {
    it("should write records to normalized stream names", async () => {
      // Write without leading slash
      await client.post("/record-test/item1", "Item 1");

      // Write with different path to same stream
      await client.post("/record-test/item2", "Item 2");

      const db = testDb.getDb();
      const stream = await db.oneOrNone(
        `SELECT * FROM stream WHERE pod_name = $(pod_name) AND name = $(name) AND parent_id IS NULL`,
        { pod_name: testPodId, name: "record-test" },
      );
      const records = await db.manyOrNone(
        `SELECT * FROM record WHERE stream_id = $(stream_id) ORDER BY index`,
        { stream_id: stream.id },
      );

      expect(records).to.have.lengthOf(2);
      expect(records[0].name).to.equal("item1");
      expect(records[1].name).to.equal("item2");
    });

    it("should read records from normalized stream names", async () => {
      // Create records
      await client.post("/read-norm/doc1", "Document 1");
      await client.post("/read-norm/doc2", "Document 2");

      // Read via API
      const response = await client.get("/read-norm");
      expect(response.status).to.equal(200);
      expect(response.data.records).to.have.lengthOf(2);
    });

    it("should handle stream deletion with normalized names", async () => {
      // Create a stream
      await client.post("/to-delete/record", "Will be deleted");

      // Delete the stream
      const response = await client.delete("/to-delete");
      expect(response.status).to.equal(204); // 204 No Content for successful DELETE

      // Verify it's gone
      const db = testDb.getDb();
      const stream = await db.oneOrNone(
        `SELECT * FROM stream WHERE pod_name = $(pod_name) AND name = $(name)`,
        { pod_name: testPodId, name: "/to-delete" },
      );
      expect(stream).to.be.null;
    });
  });

  describe("System streams normalization", () => {
    it("should handle .config streams with leading slash", async () => {
      const db = testDb.getDb();

      // Check that .config/owner was created with leading slash
      const ownerStream = await db.oneOrNone(
        `SELECT * FROM stream WHERE pod_name = $(pod_name) AND name = $(name)`,
        { pod_name: testPodId, name: "/.config/owner" },
      );
      expect(ownerStream).to.exist;
      expect(ownerStream.name).to.equal("/.config/owner");

      // Verify system stream detection works
      const response = await client.delete("/.config/owner");
      expect(response.status).to.equal(403); // Cannot delete system streams
    });

    it("should list streams with normalized names", async () => {
      // Create some streams
      await client.createStream("list-test-1");
      await client.createStream("list-test-2");
      await client.createStream("nested/list-test-3");

      // List all streams
      const response = await client.get("/.config/api/streams");
      expect(response.status).to.equal(200);

      const streamNames = response.data.streams.map((s: any) => s.name);
      expect(streamNames).to.include("/list-test-1");
      expect(streamNames).to.include("/list-test-2");
      expect(streamNames).to.include("/nested/list-test-3");
      expect(streamNames).to.include("/.config/owner");
    });
  });

  describe("Recursive queries with normalized streams", () => {
    it("should work with recursive queries on normalized paths", async () => {
      // Create nested streams
      await client.post("/recursive/level1/record1", "Level 1");
      await client.post("/recursive/level1/level2/record2", "Level 2");
      await client.post("/recursive/level1/level2/level3/record3", "Level 3");

      // Query recursively
      const response = await client.get("/recursive?recursive=true");
      expect(response.status).to.equal(200);
      expect(response.data.records).to.have.lengthOf(3);

      // Query specific nested level
      const response2 = await client.get("/recursive/level1?recursive=true");
      expect(response2.status).to.equal(200);
      expect(response2.data.records).to.have.lengthOf(3); // record1 in level1, record2 in level2, record3 in level3
    });
  });
});
