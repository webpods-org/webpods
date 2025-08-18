// Stream operations tests for WebPods
import { expect } from "chai";
import { TestHttpClient } from "webpods-test-utils";
import { testDb } from "../test-setup.js";

describe("WebPods Stream Operations", () => {
  let client: TestHttpClient;
  let userId: string;
  let authId: string;
  let authToken: string;
  const testPodId = "test-pod";
  const baseUrl = `http://${testPodId}.localhost:3099`;

  beforeEach(async () => {
    client = new TestHttpClient("http://localhost:3099");
    // Create a test user and auth token
    const db = testDb.getDb();
    const [user] = await db("user")
      .insert({
        id: crypto.randomUUID(),
        auth_id: "auth:provider:123456",
        email: "test@example.com",
        name: "Test User",
        provider: "testprovider1",
      })
      .returning("*");

    userId = user.id;
    authId = user.auth_id;

    // Generate pod-specific token for test-pod
    client.setBaseUrl(baseUrl);
    authToken = client.generatePodToken(
      {
        user_id: user.id,
        auth_id: user.auth_id,
        email: user.email,
        name: user.name,
        provider: "testprovider1",
      },
      testPodId,
    );

    client.setAuthToken(authToken);
  });

  describe("Pod and Stream Creation", () => {
    it("should create pod and stream on first write", async () => {
      const response = await client.post(
        "/my-first-stream/hello",
        "Hello WebPods!",
      );

      expect(response.status).to.equal(201);
      expect(response.data).to.have.property("index", 0);
      expect(response.data).to.have.property("content", "Hello WebPods!");
      expect(response.data).to.have.property("hash");
      expect(response.data).to.have.property("previous_hash", null);
      expect(response.data).to.have.property("author", authId);

      // Verify pod was created
      const db = testDb.getDb();
      const pod = await db("pod").where("pod_id", testPodId).first();
      expect(pod).to.exist;

      // Verify stream was created
      const stream = await db("stream")
        .where("pod_id", pod.id)
        .where("stream_id", "my-first-stream")
        .first();
      expect(stream).to.exist;
      expect(stream.creator_id).to.equal(userId);
    });

    it("should support nested stream paths", async () => {
      const response = await client.post("/blog/posts/2024/january", {
        content: "January blog post",
      });

      expect(response.status).to.equal(201);

      // Verify nested path stream was created
      const db = testDb.getDb();
      const pod = await db("pod").where("pod_id", testPodId).first();
      const stream = await db("stream")
        .where("pod_id", pod.id)
        .where("stream_id", "blog/posts/2024")
        .first();
      expect(stream).to.exist;
      expect(stream.stream_id).to.equal("blog/posts/2024");

      // Verify the record was created with name 'january'
      const record = await db("record")
        .where("stream_id", stream.id)
        .where("name", "january")
        .first();
      expect(record).to.exist;
    });

    it("should set custom permissions on stream creation", async () => {
      const response = await client.post(
        "/private-stream/secret?access=private",
        "Secret data",
      );

      expect(response.status).to.equal(201);

      const db = testDb.getDb();
      const pod = await db("pod").where("pod_id", testPodId).first();
      const stream = await db("stream")
        .where("pod_id", pod.id)
        .where("stream_id", "private-stream")
        .first();
      expect(stream.access_permission).to.equal("private");
    });
  });

  describe("Writing Records", () => {
    beforeEach(async () => {
      // Pre-create a stream
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
      expect(response.data.content_type).to.equal("text/plain");
    });

    it("should write JSON content", async () => {
      const data = { message: "JSON data", count: 42 };
      const response = await client.post("/test-stream/json", data);

      expect(response.status).to.equal(201);
      expect(response.data.content).to.deep.equal(data);
      expect(response.data.content_type).to.equal("application/json");
    });

    it("should respect X-Content-Type header", async () => {
      const response = await client.post("/test-stream/html", "<h1>HTML</h1>", {
        headers: { "X-Content-Type": "text/html" },
      });

      expect(response.status).to.equal(201);
      expect(response.data.content_type).to.equal("text/html");
    });

    it("should maintain hash chain", async () => {
      const response1 = await client.post("/hash-test/first", "First");
      const response2 = await client.post("/hash-test/second", "Second");
      const response3 = await client.post("/hash-test/third", "Third");

      expect(response1.data.previous_hash).to.be.null;
      expect(response2.data.previous_hash).to.equal(response1.data.hash);
      expect(response3.data.previous_hash).to.equal(response2.data.hash);

      // Verify hash format
      expect(response1.data.hash).to.match(/^sha256:[a-f0-9]{64}$/);
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
      expect(response.data.has_more).to.be.true;
      expect(response.data.next_index).to.equal(1);

      // Get next page
      const page2 = await client.get(
        `/read-test?limit=2&after=${response.data.next_index}`,
      );
      expect(page2.data.records).to.have.lengthOf(2);
    });

    it("should return raw content with metadata in headers", async () => {
      const response = await client.get("/read-test?i=0");
      // Express adds charset, so check if content-type starts with expected value
      expect(response.headers["content-type"]).to.include("text/plain");
      expect(response.headers["x-hash"]).to.exist;
      expect(response.headers["x-author"]).to.equal(authId);
      expect(response.headers["x-timestamp"]).to.exist;
      expect(response.data).to.equal("First");
    });
  });

  describe("System Streams (.meta/)", () => {
    it("should create .meta/owner stream on pod creation", async () => {
      await client.post("/any-stream/init", "Create pod");

      const db = testDb.getDb();
      const pod = await db("pod").where("pod_id", testPodId).first();
      const ownerStream = await db("stream")
        .where("pod_id", pod.id)
        .where("stream_id", ".meta/owner")
        .first();

      expect(ownerStream).to.exist;
      expect(ownerStream.access_permission).to.equal("private");

      // Check owner record
      const ownerRecord = await db("record")
        .where("stream_id", ownerStream.id)
        .first();
      const content = JSON.parse(ownerRecord.content);
      expect(content.owner).to.equal(userId);
    });

    it("should list streams via .meta/streams", async () => {
      // Create some streams
      await client.post("/stream1/content1", "Content 1");
      await client.post("/stream2/content2", "Content 2");
      await client.post("/nested/stream3/content3", "Content 3");

      const response = await client.get("/.meta/streams");
      expect(response.status).to.equal(200);
      expect(response.data.pod).to.equal(testPodId);
      expect(response.data.streams).to.be.an("array");

      // The post to /nested/stream3/content3 creates stream "nested/stream3" with record "content3"
      expect(
        response.data.streams.map((s: any) => s.stream_id),
      ).to.include.members([
        "stream1",
        "stream2",
        "nested/stream3",
        ".meta/owner",
      ]);
    });

    it("should update .meta/links for URL routing", async () => {
      await client.post("/homepage/index", "<h1>Welcome</h1>", {
        headers: { "X-Content-Type": "text/html" },
      });

      const links = {
        "/": "homepage?i=-1",
        "/about": "pages/about",
        "/blog": "blog?i=-10:-1",
      };

      const response = await client.post("/.meta/links", links);
      expect(response.status).to.equal(201);

      // Verify links work
      const rootResponse = await client.get("/");
      expect(rootResponse.status).to.equal(200);
      expect(rootResponse.data).to.equal("<h1>Welcome</h1>");
    });

    it("should only allow owner to write to .meta/ streams", async () => {
      // Create second user
      const db = testDb.getDb();
      const [user2] = await db("user")
        .insert({
          id: crypto.randomUUID(),
          auth_id: "auth:provider:789",
          email: "other@example.com",
          name: "Other User",
          provider: "testprovider1",
        })
        .returning("*");

      const token2 = client.generatePodToken({
        user_id: user2.id,
        auth_id: user2.auth_id,
        email: user2.email,
        name: user2.name,
        provider: "testprovider1",
      });

      // Create pod as first user
      await client.post("/test/init", "Create pod");

      // Try to update .meta/owner as second user
      client.setAuthToken(token2);
      const response = await client.post("/.meta/owner", { owner: user2.id });

      expect(response.status).to.equal(403);
      expect(response.data.error.code).to.equal("FORBIDDEN");
    });
  });

  describe("Stream Deletion", () => {
    it("should delete stream and all records", async () => {
      await client.post("/delete-me/msg1", "Message 1");
      await client.post("/delete-me/msg2", "Message 2");

      const response = await client.delete("/delete-me");
      expect(response.status).to.equal(204);

      // Verify stream is gone
      const getResponse = await client.get("/delete-me");
      expect(getResponse.status).to.equal(404);
    });

    it("should prevent deletion of system streams", async () => {
      await client.post("/test/init", "Create pod");

      const response = await client.delete("/.meta/owner");
      expect(response.status).to.equal(403);
      expect(response.data.error.code).to.equal("FORBIDDEN");
    });

    it("should only allow creator to delete stream", async () => {
      await client.post("/my-stream/content", "Content");

      // Create second user and try to delete
      const db = testDb.getDb();
      const [user2] = await db("user")
        .insert({
          id: crypto.randomUUID(),
          auth_id: "auth:provider:999",
          email: "other@example.com",
          name: "Other User",
          provider: "testprovider1",
        })
        .returning("*");

      const token2 = client.generatePodToken({
        user_id: user2.id,
        auth_id: user2.auth_id,
        email: user2.email,
        name: user2.name,
        provider: "testprovider1",
      });

      client.setAuthToken(token2);
      const response = await client.delete("/my-stream");
      expect(response.status).to.equal(403);
    });
  });

  describe("Content Types and Serving", () => {
    it("should serve HTML directly with correct content type", async () => {
      const html = "<html><body><h1>Hello</h1></body></html>";
      await client.post("/page/index", html, {
        headers: { "X-Content-Type": "text/html" },
      });

      const response = await client.get("/page/index");
      expect(response.status).to.equal(200);
      expect(response.headers["content-type"]).to.include("text/html");
      expect(response.data).to.equal(html);
    });

    it("should serve CSS with correct content type", async () => {
      const css = "body { margin: 0; }";
      await client.post("/assets/styles/main.css", css, {
        headers: { "X-Content-Type": "text/css" },
      });

      const response = await client.get("/assets/styles/main.css");
      expect(response.headers["content-type"]).to.include("text/css");
      expect(response.data).to.equal(css);
    });

    it("should serve JSON with correct content type", async () => {
      const data = { api: "response", version: 1 };
      await client.post("/api/data", data);

      const response = await client.get("/api/data");
      expect(response.headers["content-type"]).to.include("application/json");
      expect(response.data).to.deep.equal(data);
    });
  });
});
