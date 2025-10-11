// Test to verify caching doesn't affect recursive operations
import { expect } from "chai";
import {
  TestHttpClient,
  createTestUser,
  createTestPod,
  clearAllCache,
} from "webpods-test-utils";
import { testDb } from "../test-setup.js";
import { createSchema } from "@webpods/tinqer";
import { executeUpdate } from "@webpods/tinqer-sql-pg-promise";
import type { DatabaseSchema } from "webpods-test-utils";

const schema = createSchema<DatabaseSchema>();

describe("Cache Safety - Recursive Operations", () => {
  let client: TestHttpClient;
  let userId: string;
  let authToken: string;
  const testPodId = "cache-recursive-test";
  const baseUrl = `http://${testPodId}.localhost:3000`;

  beforeEach(async () => {
    client = new TestHttpClient("http://localhost:3000");
    const db = testDb.getDb();

    const user = await createTestUser(db, {
      provider: "test-cache-provider",
      providerId: `cache-user-${Date.now()}`,
      email: "cache@example.com",
      name: "Cache Test User",
    });

    userId = user.userId;
    await createTestPod(db, testPodId, userId);
    authToken = await client.authenticateViaOAuth(userId, [testPodId]);

    client.setBaseUrl(baseUrl);
    client.setAuthToken(authToken);
  });

  afterEach(async () => {
    await clearAllCache();
  });

  describe("Recursive Listing with Cache", () => {
    it("should return fresh data for recursive queries even with active caching", async () => {
      // Create nested stream structure
      await client.createStream("blog", "public");
      await client.createStream("blog/posts", "public");
      await client.createStream("blog/posts/2024", "public");
      await client.createStream("blog/drafts", "private");

      // Add records to different levels
      await client.post("/blog/intro", { content: "Blog intro" });
      await client.post("/blog/posts/post1", { title: "First post" });
      await client.post("/blog/posts/2024/jan", { month: "January" });
      await client.post("/blog/drafts/draft1", { status: "draft" });

      // Do a non-recursive query first to populate cache
      const blogList = await client.get("/blog");
      expect(blogList.status).to.equal(200);
      const blogRecords = Array.isArray(blogList.data)
        ? blogList.data
        : blogList.data.records;
      expect(blogRecords).to.have.lengthOf(1); // Only 'intro' record

      // Do recursive query - should NOT use cache from above
      const recursiveList = await client.get("/blog?recursive=true");
      expect(recursiveList.status).to.equal(200);
      const allRecords = Array.isArray(recursiveList.data)
        ? recursiveList.data
        : recursiveList.data.records;

      // Should have all records from all nested streams
      expect(allRecords.length).to.be.greaterThan(1);
      const recordNames = allRecords.map((r: any) => r.name);
      expect(recordNames).to.include.members([
        "intro",
        "post1",
        "jan",
        "draft1",
      ]);
    });

    it("should reflect immediate changes in recursive queries", async () => {
      // Create structure
      await client.createStream("data", "public");
      await client.createStream("data/v1", "public");
      await client.createStream("data/v2", "public");

      // Add initial records
      await client.post("/data/v1/item1", { version: 1 });
      await client.post("/data/v2/item2", { version: 2 });

      // First recursive query
      const list1 = await client.get("/data?recursive=true");
      const records1 = Array.isArray(list1.data)
        ? list1.data
        : list1.data.records;
      const count1 = records1.length;

      // Add new record in nested stream
      await client.post("/data/v1/item3", { version: 1, new: true });

      // Second recursive query - should see new record immediately
      const list2 = await client.get("/data?recursive=true");
      const records2 = Array.isArray(list2.data)
        ? list2.data
        : list2.data.records;

      expect(records2.length).to.equal(count1 + 1);
      expect(records2.some((r: any) => r.name === "item3")).to.be.true;
    });

    it("should handle permission changes correctly in recursive queries", async () => {
      // Create public and private streams
      await client.createStream("content", "public");
      await client.createStream("content/public", "public");
      await client.createStream("content/private", "private");

      // Add records
      await client.post("/content/public/item1", { access: "public" });
      await client.post("/content/private/item2", { access: "private" });

      // Recursive query should see both (owner has access to private)
      const list1 = await client.get("/content?recursive=true");
      const records1 = Array.isArray(list1.data)
        ? list1.data
        : list1.data.records;
      const names1 = records1.map((r: any) => r.name);
      expect(names1).to.include.members(["item1", "item2"]);

      // Update stream permission directly in DB (simulating permission change)
      const db = testDb.getDb();
      await executeUpdate(
        db,
        schema,
        (q, p) =>
          q
            .update("stream")
            .set({ access_permission: "owner" })
            .where((s) => s.pod_name === p.podName && s.name === p.streamName),
        { podName: testPodId, streamName: "content/public" },
      );

      // Even if we have cached the stream as "public",
      // recursive query should check fresh permissions
      const list2 = await client.get("/content?recursive=true");
      const records2 = Array.isArray(list2.data)
        ? list2.data
        : list2.data.records;
      // Should still see both since owner has access
      expect(records2.length).to.equal(records1.length);
    });

    it("should not use stale cached stream lists in recursive queries", async () => {
      // Create initial structure
      await client.createStream("project", "public");
      await client.createStream("project/src", "public");

      // Cache the stream list by doing a non-recursive operation
      const streamList1 = await client.get("/.config/api/streams");
      expect(streamList1.status).to.equal(200);

      // Add records to existing streams
      await client.post("/project/README", { type: "doc" });
      await client.post("/project/src/main.js", { type: "code" });

      // Do recursive query - should see all records
      const list1 = await client.get("/project?recursive=true");
      const records1 = Array.isArray(list1.data)
        ? list1.data
        : list1.data.records;
      expect(records1).to.have.lengthOf(2);

      // Create NEW nested stream (this invalidates stream list cache)
      await client.createStream("project/tests", "public");
      await client.post("/project/tests/test1.js", { type: "test" });

      // Recursive query should immediately see records from new stream
      const list2 = await client.get("/project?recursive=true");
      const records2 = Array.isArray(list2.data)
        ? list2.data
        : list2.data.records;
      expect(records2).to.have.lengthOf(3);
      expect(records2.some((r: any) => r.name === "test1.js")).to.be.true;
    });

    it("should handle deeply nested recursive queries correctly", async () => {
      // Create deep nesting
      await client.createStream("a", "public");
      await client.createStream("a/b", "public");
      await client.createStream("a/b/c", "public");
      await client.createStream("a/b/c/d", "public");
      await client.createStream("a/b/c/d/e", "public");

      // Add records at each level
      await client.post("/a/r1", { level: 1 });
      await client.post("/a/b/r2", { level: 2 });
      await client.post("/a/b/c/r3", { level: 3 });
      await client.post("/a/b/c/d/r4", { level: 4 });
      await client.post("/a/b/c/d/e/r5", { level: 5 });

      // Cache some individual levels
      await client.get("/a");
      await client.get("/a/b/c");

      // Recursive from top should see all
      const topRecursive = await client.get("/a?recursive=true");
      const topRecords = Array.isArray(topRecursive.data)
        ? topRecursive.data
        : topRecursive.data.records;
      expect(topRecords).to.have.lengthOf(5);

      // Recursive from middle should see subset
      const midRecursive = await client.get("/a/b/c?recursive=true");
      const midRecords = Array.isArray(midRecursive.data)
        ? midRecursive.data
        : midRecursive.data.records;
      expect(midRecords).to.have.lengthOf(3); // r3, r4, r5

      // Update a deep record
      await client.post("/a/b/c/d/e/r5", { level: 5, updated: true });

      // Should immediately reflect in recursive query
      const updatedRecursive = await client.get("/a?recursive=true");
      const updatedRecords = Array.isArray(updatedRecursive.data)
        ? updatedRecursive.data
        : updatedRecursive.data.records;

      // Find the most recent r5 record (highest index)
      const r5Records = updatedRecords.filter((r: any) => r.name === "r5");
      expect(r5Records.length).to.be.greaterThan(
        0,
        "Should find at least one r5 record",
      );

      // Get the latest one (highest index)
      const r5 = r5Records.reduce((latest: any, current: any) =>
        current.index > latest.index ? current : latest,
      );

      const content =
        typeof r5.content === "string" ? JSON.parse(r5.content) : r5.content;
      expect(content, "Content should be an object").to.be.an("object");
      expect(content.updated, "Updated flag should be true").to.be.true;
    });
  });

  describe("Recursive Unique Listing with Cache", () => {
    it("should return correct unique records recursively", async () => {
      // Create structure
      await client.createStream("store", "public");
      await client.createStream("store/products", "public");
      await client.createStream("store/products/electronics", "public");

      // Add records with same names in different streams
      await client.post("/store/products/item", { category: "general", v: 1 });
      await client.post("/store/products/item", { category: "general", v: 2 });
      await client.post("/store/products/electronics/item", {
        category: "electronics",
        v: 1,
      });
      await client.post("/store/products/electronics/item", {
        category: "electronics",
        v: 2,
      });

      // Non-recursive unique should only see from one stream
      const uniqueSingle = await client.get("/store/products?unique=true");
      const singleRecords = Array.isArray(uniqueSingle.data)
        ? uniqueSingle.data
        : uniqueSingle.data.records;
      expect(
        singleRecords.filter((r: any) => r.name === "item"),
      ).to.have.lengthOf(1);

      // Recursive unique should see latest from EACH stream
      const uniqueRecursive = await client.get(
        "/store?recursive=true&unique=true",
      );
      const recursiveRecords = Array.isArray(uniqueRecursive.data)
        ? uniqueRecursive.data
        : uniqueRecursive.data.records;

      // Should have 2 'item' records (one from each stream with that name)
      const itemRecords = recursiveRecords.filter(
        (r: any) => r.name === "item",
      );
      expect(itemRecords).to.have.lengthOf(2);
    });
  });
});
