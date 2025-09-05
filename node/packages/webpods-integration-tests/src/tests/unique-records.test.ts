/**
 * Tests for ?unique=true query parameter
 */

import { expect } from "chai";
import {
  TestHttpClient,
  createTestUser,
  createTestPod,
} from "webpods-test-utils";
import { testDb } from "../test-setup.js";
import jwt from "jsonwebtoken";

describe("Unique Records Listing", () => {
  let podClient: TestHttpClient;
  let authToken: string;
  let userId: string;
  const podId = `unique-test-${Date.now()}`;

  beforeEach(async () => {
    podClient = new TestHttpClient(`http://${podId}.localhost:3000`);

    // Create test user and pod
    const db = testDb.getDb();
    const user = await createTestUser(db, {
      email: "unique-test@example.com",
      name: "Unique Test User",
    });
    userId = user.userId;

    // Generate JWT token for the user
    authToken = jwt.sign(
      {
        sub: userId,
        iat: Math.floor(Date.now() / 1000),
        type: "webpods",
      },
      process.env.JWT_SECRET || "test-secret-key",
      { expiresIn: "1h" },
    );

    await createTestPod(db, podId, userId);
  });

  describe("GET /{stream}?unique=true", () => {
    it("should return only latest version of each named record", async () => {
      // Create stream first
      await podClient.post(
        "/blog",
        "",
        {
          headers: { Authorization: `Bearer ${authToken}` },
        },
      );

      // Write multiple versions of the same named records
      const firstResponse = await podClient.post("/blog/post-1", "Version 1", {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      expect(firstResponse.status).to.equal(201);

      await podClient.post("/blog/post-2", "Content 2", {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      await podClient.post("/blog/post-1", "Version 2", {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      await podClient.post("/blog/post-3", "Content 3", {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      await podClient.post("/blog/post-2", "Updated Content 2", {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      // Get all records (without unique)
      const allResponse = await podClient.get("/blog?limit=100");
      expect(allResponse.status).to.equal(200);
      expect(allResponse.data.records).to.have.length(5);

      // Get unique records
      const uniqueResponse = await podClient.get("/blog?unique=true");
      expect(uniqueResponse.status).to.equal(200);
      expect(uniqueResponse.data.records).to.have.length(3);

      // Verify we got the latest versions
      const records = uniqueResponse.data.records;
      const post1 = records.find((r: any) => r.name === "post-1");
      const post2 = records.find((r: any) => r.name === "post-2");
      const post3 = records.find((r: any) => r.name === "post-3");

      expect(post1.content).to.equal("Version 2");
      expect(post2.content).to.equal("Updated Content 2");
      expect(post3.content).to.equal("Content 3");
    });

    it("should exclude deleted records when unique=true", async () => {
      // Create stream first
      await podClient.put(
        "/unique-test?access=public",
        { name: "docs" },
        {
          headers: { Authorization: `Bearer ${authToken}` },
        },
      );

      // Create records
      await podClient.post("/docs/page-1", "Page 1 content", {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      await podClient.post("/docs/page-2", "Page 2 content", {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      await podClient.post("/docs/page-3", "Page 3 content", {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      // Soft delete page-2
      await podClient.post("/docs/page-2", JSON.stringify({ deleted: true }), {
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
        },
      });

      // Get unique records
      const response = await podClient.get("/docs?unique=true");
      expect(response.status).to.equal(200);
      expect(response.data.records).to.have.length(2);

      // Verify page-2 is not in the results
      const names = response.data.records.map((r: any) => r.name);
      expect(names).to.include("page-1");
      expect(names).to.include("page-3");
      expect(names).to.not.include("page-2");
    });

    it("should handle purged records correctly", async () => {
      // Create stream first
      await podClient.put(
        "/unique-test?access=public",
        { name: "items" },
        {
          headers: { Authorization: `Bearer ${authToken}` },
        },
      );

      // Create records
      await podClient.post("/items/item-1", "Item 1", {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      await podClient.post("/items/item-2", "Item 2", {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      // Purge item-1
      await podClient.post("/items/item-1", JSON.stringify({ purged: true }), {
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
        },
      });

      // Get unique records
      const response = await podClient.get("/items?unique=true");
      expect(response.status).to.equal(200);
      expect(response.data.records).to.have.length(1);
      expect(response.data.records[0].name).to.equal("item-2");
    });

    it("should work with pagination", async () => {
      // Create stream first
      await podClient.put(
        "/unique-test?access=public",
        { name: "pages" },
        {
          headers: { Authorization: `Bearer ${authToken}` },
        },
      );

      // Create many unique records
      for (let i = 1; i <= 10; i++) {
        await podClient.post(`/pages/page-${i}`, `Content ${i}`, {
          headers: { Authorization: `Bearer ${authToken}` },
        });
      }

      // Get first page
      const page1 = await podClient.get("/pages?unique=true&limit=5");
      expect(page1.status).to.equal(200);
      expect(page1.data.records).to.have.length(5);
      expect(page1.data.hasMore).to.be.true;
      expect(page1.data.total).to.equal(10);

      // Get second page
      const lastIndex = page1.data.nextIndex;
      const page2 = await podClient.get(
        `/pages?unique=true&limit=5&after=${lastIndex}`,
      );
      expect(page2.status).to.equal(200);
      expect(page2.data.records).to.have.length(5);
    });

    it("should return correct results for unique filter", async () => {
      // Create stream first
      await podClient.put(
        "/unique-test?access=public",
        { name: "data" },
        {
          headers: { Authorization: `Bearer ${authToken}` },
        },
      );

      // Create some named records
      await podClient.post("/data/item1", "Record 1", {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      await podClient.post("/data/item2", "Record 2", {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      // Get unique records
      const response = await podClient.get("/data?unique=true");
      expect(response.status).to.equal(200);
      expect(response.data.records).to.have.length(2);
      expect(response.data.total).to.equal(2);

      // Verify we get the named records
      const names = response.data.records.map((r: any) => r.name);
      expect(names).to.include("item1");
      expect(names).to.include("item2");
    });

    it("should support negative 'after' parameter with unique=true", async () => {
      // Create stream first
      await podClient.put(
        "/unique-test?access=public",
        { name: "negtest" },
        {
          headers: { Authorization: `Bearer ${authToken}` },
        },
      );

      // Create multiple named records
      await podClient.post("/negtest/item1", "First item", {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      await podClient.post("/negtest/item2", "Second item", {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      await podClient.post("/negtest/item3", "Third item", {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      await podClient.post("/negtest/item4", "Fourth item", {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      await podClient.post("/negtest/item5", "Fifth item", {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      // Get last 3 unique records using negative after
      const response = await podClient.get("/negtest?unique=true&after=-3");
      expect(response.status).to.equal(200);
      expect(response.data.records).to.have.length(3);

      // Should get the last 3 items
      const names = response.data.records.map((r: any) => r.name);
      expect(names).to.deep.equal(["item3", "item4", "item5"]);
    });

    it("should handle updates after deletion correctly", async () => {
      // Create stream first
      await podClient.put(
        "/unique-test?access=public",
        { name: "content" },
        {
          headers: { Authorization: `Bearer ${authToken}` },
        },
      );

      // Create, delete, then recreate a record
      await podClient.post("/content/article", "Version 1", {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      // Soft delete
      await podClient.post(
        "/content/article",
        JSON.stringify({ deleted: true }),
        {
          headers: {
            Authorization: `Bearer ${authToken}`,
            "Content-Type": "application/json",
          },
        },
      );

      // Recreate with new content
      await podClient.post("/content/article", "Version 2 - New", {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      // Get unique records
      const response = await podClient.get("/content?unique=true");
      expect(response.status).to.equal(200);
      expect(response.data.records).to.have.length(1);
      expect(response.data.records[0].content).to.equal("Version 2 - New");
    });
  });
});
