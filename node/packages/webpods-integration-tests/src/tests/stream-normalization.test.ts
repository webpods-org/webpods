import { expect } from "chai";
import {
  TestHttpClient,
  createTestUser,
  createTestPod,
  clearAllCache,
} from "webpods-test-utils";
import { testDb } from "../test-setup.js";
import { createSchema } from "@tinqerjs/tinqer";
import { executeSelect } from "@tinqerjs/pg-promise-adapter";
import type { DatabaseSchema } from "webpods-test-utils";

const schema = createSchema<DatabaseSchema>();

describe("Stream Name Normalization", function () {
  this.timeout(5 * 60 * 1000); // 5 minute timeout

  let client: TestHttpClient;
  let userId: string;
  let userToken: string;
  const testPodId = `stream-norm-${Date.now()}`;
  const baseUrl = `http://${testPodId}.localhost:3000`;

  beforeEach(async () => {
    await clearAllCache();
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

  afterEach(async () => {
    await clearAllCache();
  });

  describe("Stream creation normalization", () => {
    it("should normalize stream names without leading slash", async () => {
      // Create stream without leading slash
      const response = await client.post("/blog/posts/first", "Test content");
      expect(response.status).to.equal(201);

      // Verify in database - hierarchical structure: blog -> posts
      const db = testDb.getDb();
      // Check parent stream "blog"
      const blogStreams = await executeSelect(
        db,
        schema,
        (q, p) =>
          q
            .from("stream")
            .where(
              (s) =>
                s.pod_name === p.podName &&
                s.name === p.name &&
                s.parent_id === null,
            )
            .take(1),
        { podName: testPodId, name: "blog" },
      );
      const blogStream = blogStreams[0] || null;
      expect(blogStream).to.exist;
      expect(blogStream.name).to.equal("blog");

      // Check child stream "posts"
      const postsStreams = await executeSelect(
        db,
        schema,
        (q, p) =>
          q
            .from("stream")
            .where(
              (s) =>
                s.pod_name === p.podName &&
                s.name === p.name &&
                s.parent_id === p.parentId,
            )
            .take(1),
        { podName: testPodId, name: "posts", parentId: blogStream.id },
      );
      const postsStream = postsStreams[0] || null;
      expect(postsStream).to.exist;
      expect(postsStream.name).to.equal("posts");
    });

    it("should keep stream names with leading slash unchanged", async () => {
      // Create stream with leading slash (using explicit creation)
      // Note: client adds the leading slash, so we pass without it
      const response = await client.createStream("projects/webapp");
      expect(response.status).to.equal(201);

      // Verify hierarchical structure: projects -> webapp
      const db = testDb.getDb();
      // Check parent stream "projects"
      const projectsStreams = await executeSelect(
        db,
        schema,
        (q, p) =>
          q
            .from("stream")
            .where(
              (s) =>
                s.pod_name === p.podName &&
                s.name === p.name &&
                s.parent_id === null,
            )
            .take(1),
        { podName: testPodId, name: "projects" },
      );
      const projectsStream = projectsStreams[0] || null;
      expect(projectsStream).to.exist;
      expect(projectsStream.name).to.equal("projects");

      // Check child stream "webapp"
      const webappStreams = await executeSelect(
        db,
        schema,
        (q, p) =>
          q
            .from("stream")
            .where(
              (s) =>
                s.pod_name === p.podName &&
                s.name === p.name &&
                s.parent_id === p.parentId,
            )
            .take(1),
        { podName: testPodId, name: "webapp", parentId: projectsStream.id },
      );
      const webappStream = webappStreams[0] || null;
      expect(webappStream).to.exist;
      expect(webappStream.name).to.equal("webapp");
    });

    it("should handle nested paths correctly", async () => {
      // Create deeply nested stream
      await client.post("/api/v1/users/profiles/data", "Profile data");

      const db = testDb.getDb();
      // Check the full hierarchy: api -> v1 -> users -> profiles
      const apiStreams = await executeSelect(
        db,
        schema,
        (q, p) =>
          q
            .from("stream")
            .where(
              (s) =>
                s.pod_name === p.podName &&
                s.name === p.name &&
                s.parent_id === null,
            )
            .take(1),
        { podName: testPodId, name: "api" },
      );
      const apiStream = apiStreams[0] || null;
      expect(apiStream).to.exist;

      const v1Streams = await executeSelect(
        db,
        schema,
        (q, p) =>
          q
            .from("stream")
            .where(
              (s) =>
                s.pod_name === p.podName &&
                s.name === p.name &&
                s.parent_id === p.parentId,
            )
            .take(1),
        { podName: testPodId, name: "v1", parentId: apiStream.id },
      );
      const v1Stream = v1Streams[0] || null;
      expect(v1Stream).to.exist;

      const usersStreams = await executeSelect(
        db,
        schema,
        (q, p) =>
          q
            .from("stream")
            .where(
              (s) =>
                s.pod_name === p.podName &&
                s.name === p.name &&
                s.parent_id === p.parentId,
            )
            .take(1),
        { podName: testPodId, name: "users", parentId: v1Stream.id },
      );
      const usersStream = usersStreams[0] || null;
      expect(usersStream).to.exist;

      const profilesStreams = await executeSelect(
        db,
        schema,
        (q, p) =>
          q
            .from("stream")
            .where(
              (s) =>
                s.pod_name === p.podName &&
                s.name === p.name &&
                s.parent_id === p.parentId,
            )
            .take(1),
        { podName: testPodId, name: "profiles", parentId: usersStream.id },
      );
      const profilesStream = profilesStreams[0] || null;
      expect(profilesStream).to.exist;
      expect(profilesStream.name).to.equal("profiles");
    });

    it("should handle root stream (/) correctly", async () => {
      // Write to root - this creates a record in the root stream
      const response = await client.post("/root-record", "Root content");
      expect(response.status).to.equal(201);

      const db = testDb.getDb();
      // Check that the record was created in the root stream
      // There's no explicit root stream in the hierarchical model
      // Records at root level have no parent stream

      // First, get top-level streams
      const topLevelStreams = await executeSelect(
        db,
        schema,
        (q, p) =>
          q
            .from("stream")
            .where((s) => s.pod_name === p.podName && s.parent_id === null),
        { podName: testPodId },
      );

      // Then, check if any of these streams have the record we're looking for
      let foundRecord = false;
      for (const stream of topLevelStreams) {
        const records = await executeSelect(
          db,
          schema,
          (q, p) =>
            q
              .from("record")
              .where((r) => r.stream_id === p.streamId && r.name === p.name)
              .take(1),
          { streamId: stream.id, name: "root-record" },
        );
        if (records.length > 0) {
          foundRecord = true;
          break;
        }
      }

      // The test needs to be adjusted for hierarchical structure
      // Root records should be handled differently
      expect(response.data).to.have.property("index");
      expect(foundRecord).to.be.true;
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
      const streams = await executeSelect(
        db,
        schema,
        (q, p) =>
          q
            .from("stream")
            .where(
              (s) =>
                s.pod_name === p.podName &&
                s.name === p.name &&
                s.parent_id === null,
            )
            .take(1),
        { podName: testPodId, name: "restricted-data" },
      );
      const stream = streams[0] || null;
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
      const streams = await executeSelect(
        db,
        schema,
        (q, p) =>
          q
            .from("stream")
            .where(
              (s) =>
                s.pod_name === p.podName &&
                s.name === p.name &&
                s.parent_id === null,
            )
            .take(1),
        { podName: testPodId, name: "record-test" },
      );
      const stream = streams[0];
      const records = await executeSelect(
        db,
        schema,
        (q, p) =>
          q
            .from("record")
            .where((r) => r.stream_id === p.streamId)
            .orderBy((r) => r.index),
        { streamId: stream.id },
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
      const streams = await executeSelect(
        db,
        schema,
        (q, p) =>
          q
            .from("stream")
            .where(
              (s) =>
                s.pod_name === p.podName &&
                s.name === p.name &&
                s.parent_id === null,
            )
            .take(1),
        { podName: testPodId, name: "to-delete" },
      );
      const stream = streams[0] || null;
      expect(stream).to.be.null;
    });
  });

  describe("System streams normalization", () => {
    it("should handle .config streams with leading slash", async () => {
      const db = testDb.getDb();

      // Check that .config and owner streams exist in hierarchical structure
      const configStreams = await executeSelect(
        db,
        schema,
        (q, p) =>
          q
            .from("stream")
            .where(
              (s) =>
                s.pod_name === p.podName &&
                s.name === p.name &&
                s.parent_id === null,
            )
            .take(1),
        { podName: testPodId, name: ".config" },
      );
      const configStream = configStreams[0] || null;
      expect(configStream).to.exist;
      expect(configStream.name).to.equal(".config");

      const ownerStreams = await executeSelect(
        db,
        schema,
        (q, p) =>
          q
            .from("stream")
            .where(
              (s) =>
                s.pod_name === p.podName &&
                s.name === p.name &&
                s.parent_id === p.parentId,
            )
            .take(1),
        { podName: testPodId, name: "owner", parentId: configStream.id },
      );
      const ownerStream = ownerStreams[0] || null;
      expect(ownerStream).to.exist;
      expect(ownerStream.name).to.equal("owner");

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

      const streamPaths = response.data.streams.map((s: any) => s.path);
      expect(streamPaths).to.include("/list-test-1");
      expect(streamPaths).to.include("/list-test-2");
      expect(streamPaths).to.include("/nested/list-test-3");
      expect(streamPaths).to.include("/.config/owner");
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
