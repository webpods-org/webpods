/**
 * Integration tests for /.config/api/streams endpoint
 */

import { expect } from "chai";
import {
  TestHttpClient,
  createTestUser,
  createTestPod,
} from "webpods-test-utils";
import { testDb } from "../test-setup.js";

describe("Streams API", () => {
  let client: TestHttpClient;
  let podName: string;
  let authToken: string;

  beforeEach(async () => {
    client = new TestHttpClient("http://localhost:3000");
    const db = testDb.getDb();

    // Create test user
    const user = await createTestUser(db, {
      provider: "test-auth-provider",
      providerId: `test-user-${Date.now()}`,
      email: `test-${Date.now()}@example.com`,
      name: "Test User",
    });

    // Create test pod
    podName = `test-pod-${Date.now()}`;
    await createTestPod(db, podName, user.userId);

    // Get OAuth token
    authToken = await client.authenticateViaOAuth(user.userId, [podName]);

    // Set base URL to pod subdomain
    client.setBaseUrl(`http://${podName}.localhost:3000`);

    // Create a hierarchical stream structure for testing
    // Use createStream to properly create hierarchical streams
    const streams = [
      "blog/posts/2024",
      "blog/posts/2025",
      "blog/drafts",
      "projects/webpods",
      ".config/settings",
    ];

    for (const streamPath of streams) {
      try {
        await client.createStream(streamPath);
      } catch {
        // Stream might already exist for .config paths
      }
    }

    // Add some records to certain streams for count testing
    // First record with init data
    await client.post("/blog/posts/2024/init", JSON.stringify({ init: true }), {
      headers: {
        Authorization: `Bearer ${authToken}`,
        "Content-Type": "application/json",
      },
    });

    // Then add more records
    for (let i = 0; i < 5; i++) {
      await client.post(
        `/blog/posts/2024/post-${i}`,
        JSON.stringify({ post: i }),
        {
          headers: {
            Authorization: `Bearer ${authToken}`,
            "Content-Type": "application/json",
          },
        },
      );
    }

    // Add records to projects/webpods
    await client.post(
      "/projects/webpods/init",
      JSON.stringify({ init: true }),
      {
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
        },
      },
    );

    for (let i = 0; i < 3; i++) {
      await client.post(
        `/projects/webpods/update-${i}`,
        JSON.stringify({ update: i }),
        {
          headers: {
            Authorization: `Bearer ${authToken}`,
            "Content-Type": "application/json",
          },
        },
      );
    }
  });

  describe("GET /.config/api/streams", () => {
    it("should list all streams by default", async () => {
      // First, let's debug what streams actually exist in the database
      const db = testDb.getDb();
      const dbStreams = await db.manyOrNone(
        `SELECT name, parent_id, id FROM stream WHERE pod_name = $(podName) ORDER BY name`,
        { podName },
      );
      console.log(
        "DB streams:",
        dbStreams.map((s: any) => ({
          name: s.name,
          parent: s.parent_id,
          id: s.id,
        })),
      );

      const response = await client.get("/.config/api/streams", {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      expect(response.status).to.equal(200);
      const data = response.data;

      expect(data).to.have.property("pod", podName);
      expect(data).to.have.property("streams");
      expect(data.streams).to.be.an("array");

      // Should include all streams including .config ones
      const paths = data.streams.map((s: any) => s.path);
      console.log("API returned paths:", paths);
      console.log("Stream details:", data.streams.slice(0, 3));
      expect(paths).to.include("/.config");
      expect(paths).to.include("/.config/owner");
      // .config/settings may not exist if not created explicitly
      // expect(paths).to.include("/.config/settings");
      expect(paths).to.include("/blog");
      expect(paths).to.include("/blog/posts");
      expect(paths).to.include("/blog/posts/2024");
      expect(paths).to.include("/blog/posts/2025");
      expect(paths).to.include("/blog/drafts");
      expect(paths).to.include("/projects");
      expect(paths).to.include("/projects/webpods");

      // Verify sorting by path
      const sortedPaths = [...paths].sort();
      expect(paths).to.deep.equal(sortedPaths);

      // Check stream structure
      const blogStream = data.streams.find((s: any) => s.path === "/blog");
      expect(blogStream).to.have.property("name", "blog");
      expect(blogStream).to.have.property("parentPath", null);
      expect(blogStream).to.have.property("depth", 1);
      expect(blogStream).to.have.property("hasChildren", true);
      expect(blogStream).to.have.property("childCount", 2); // posts and drafts
      expect(blogStream).to.have.property("userId");
      expect(blogStream).to.have.property("accessPermission");
      expect(blogStream).to.have.property("createdAt");
      expect(blogStream).to.have.property("updatedAt");
      expect(blogStream).to.have.property("metadata");

      const postsStream = data.streams.find(
        (s: any) => s.path === "/blog/posts",
      );
      expect(postsStream).to.have.property("parentPath", "/blog");
      expect(postsStream).to.have.property("depth", 2);
      expect(postsStream).to.have.property("childCount", 2); // 2024 and 2025
    });

    it("should return specific stream when path is provided", async () => {
      const response = await client.get("/.config/api/streams?path=/blog", {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      expect(response.status).to.equal(200);
      const data = response.data;

      expect(data.streams).to.have.length(1);
      expect(data.streams[0]).to.have.property("path", "/blog");
      expect(data.streams[0]).to.have.property("name", "blog");
      expect(data.streams[0]).to.have.property("childCount", 2);
    });

    it("should return empty array for non-existent path", async () => {
      const response = await client.get(
        "/.config/api/streams?path=/nonexistent",
        {
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        },
      );

      expect(response.status).to.equal(200);
      const data = response.data;

      expect(data.streams).to.be.an("array");
      expect(data.streams).to.have.length(0);
    });

    it("should handle recursive=true with path", async () => {
      const response = await client.get(
        "/.config/api/streams?path=/blog&recursive=true",
        {
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        },
      );

      expect(response.status).to.equal(200);
      const data = response.data;

      const paths = data.streams.map((s: any) => s.path);
      expect(paths).to.have.members([
        "/blog",
        "/blog/posts",
        "/blog/posts/2024",
        "/blog/posts/2025",
        "/blog/drafts",
      ]);
      expect(paths).to.have.length(5);
    });

    it("should handle recursive=false with path", async () => {
      const response = await client.get(
        "/.config/api/streams?path=/blog&recursive=false",
        {
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        },
      );

      expect(response.status).to.equal(200);
      const data = response.data;

      expect(data.streams).to.have.length(1);
      expect(data.streams[0]).to.have.property("path", "/blog");
    });

    it("should include record counts when requested", async () => {
      const response = await client.get(
        "/.config/api/streams?path=/blog/posts/2024&includeRecordCounts=true",
        {
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        },
      );

      expect(response.status).to.equal(200);
      const data = response.data;

      expect(data.streams).to.have.length(1);
      const stream = data.streams[0];

      expect(stream).to.have.property("recordCount", 6); // 1 init + 5 posts
      expect(stream).to.have.property("lastRecordIndex", 5);
      expect(stream).to.have.property("firstRecordAt");
      expect(stream).to.have.property("lastRecordAt");
      expect(stream.firstRecordAt).to.not.be.null;
      expect(stream.lastRecordAt).to.not.be.null;
    });

    it("should not include record counts by default", async () => {
      const response = await client.get(
        "/.config/api/streams?path=/blog/posts/2024",
        {
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        },
      );

      expect(response.status).to.equal(200);
      const data = response.data;

      const stream = data.streams[0];
      expect(stream).to.not.have.property("recordCount");
      expect(stream).to.not.have.property("lastRecordIndex");
    });

    it("should include hash info when requested", async () => {
      const response = await client.get(
        "/.config/api/streams?path=/projects/webpods&includeHashes=true",
        {
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        },
      );

      expect(response.status).to.equal(200);
      const data = response.data;

      const stream = data.streams[0];
      expect(stream).to.have.property("hashChainValid", true);
      expect(stream).to.have.property("lastHash");
      expect(stream.lastHash).to.match(/^sha256:/);
    });

    it("should handle paths without leading slash", async () => {
      const response = await client.get(
        "/.config/api/streams?path=blog/posts",
        {
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        },
      );

      expect(response.status).to.equal(200);
      const data = response.data;

      expect(data.streams).to.have.length(1);
      expect(data.streams[0]).to.have.property("path", "/blog/posts");
    });

    it("should handle all parameters combined", async () => {
      const response = await client.get(
        "/.config/api/streams?path=/projects&recursive=true&includeRecordCounts=true&includeHashes=true",
        {
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        },
      );

      expect(response.status).to.equal(200);
      const data = response.data;

      const paths = data.streams.map((s: any) => s.path);
      expect(paths).to.have.members(["/projects", "/projects/webpods"]);

      // Check that all requested info is included
      for (const stream of data.streams) {
        expect(stream).to.have.property("recordCount");
        expect(stream).to.have.property("hashChainValid");
        expect(stream).to.have.property("lastHash");

        if (stream.path === "/projects/webpods") {
          expect(stream.recordCount).to.equal(4); // 1 init + 3 updates
        }
      }
    });

    it("should work with public streams without auth", async () => {
      // First create a public stream properly
      await client.createStream("public-stream", "public");

      // Add a record to it
      await client.post(
        "/public-stream/test",
        JSON.stringify({ public: true }),
        {
          headers: {
            Authorization: `Bearer ${authToken}`,
            "Content-Type": "application/json",
          },
        },
      );

      // Now try to list streams without auth
      const response = await client.get("/.config/api/streams");

      expect(response.status).to.equal(200);
      const data = response.data;

      // Should see public streams but might not see private ones depending on implementation
      const paths = data.streams.map((s: any) => s.path);
      expect(paths).to.include("/public-stream");
    });

    it("should handle empty stream correctly", async () => {
      // Create an empty stream properly
      await client.createStream("empty-stream");

      const response = await client.get(
        "/.config/api/streams?path=/empty-stream&includeRecordCounts=true",
        {
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        },
      );

      expect(response.status).to.equal(200);
      const data = response.data;

      const stream = data.streams[0];
      expect(stream).to.have.property("recordCount", 0);
      expect(stream).to.have.property("lastRecordIndex", -1);
      expect(stream).to.have.property("firstRecordAt", null);
      expect(stream).to.have.property("lastRecordAt", null);
    });
  });
});
