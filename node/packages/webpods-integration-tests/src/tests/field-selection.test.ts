/**
 * Tests for field selection and content truncation
 */

import { describe, it, beforeEach } from "mocha";
import { expect } from "chai";
import {
  TestHttpClient,
  createTestUser,
  createTestPod,
  clearAllCache,
} from "webpods-test-utils";
import { testDb } from "../test-setup.js";

describe("Field Selection and Content Truncation", () => {
  let client: TestHttpClient;
  let authToken: string;
  const testPodId = "test-fields";
  const baseUrl = `http://${testPodId}.localhost:3000`;

  beforeEach(async () => {
    await clearAllCache();
    client = new TestHttpClient("http://localhost:3000");
    // Create a test user and auth token
    const db = testDb.getDb();
    const user = await createTestUser(db, {
      provider: "test-auth-provider-1",
      providerId: "fields123",
      email: "fields@example.com",
      name: "Fields Test User",
    });

    // Create the test pod
    await createTestPod(db, testPodId, user.userId);

    // Get OAuth token using the proper test helper
    authToken = await client.authenticateViaOAuth(user.userId, [testPodId]);

    // Set base URL to pod subdomain
    client.setBaseUrl(baseUrl);

    // Create test stream
    await client.post(
      "/streams/test-stream",
      {},
      {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      },
    );
  });

  afterEach(async () => {
    await clearAllCache();
  });

  describe("Field Selection", () => {
    beforeEach(async () => {
      // Write test records with different content
      await client.post(
        "/test-stream/record1",
        "This is test content for record 1",
        {
          headers: {
            Authorization: `Bearer ${authToken}`,
            "Content-Type": "text/plain",
          },
        },
      );

      await client.post(
        "/test-stream/record2",
        { message: "JSON content", value: 42 },
        {
          headers: {
            Authorization: `Bearer ${authToken}`,
            "Content-Type": "application/json",
          },
        },
      );
    });

    it("should return only requested fields", async () => {
      const response = await client.get(
        "/test-stream?fields=name,index,timestamp",
        {
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        },
      );

      expect(response.status).to.equal(200);
      expect(response.data).to.exist;
      expect(response.data.records).to.exist;
      expect(response.data.records).to.have.lengthOf(2);

      const record = response.data.records[0];
      expect(record).to.have.all.keys("name", "index", "timestamp");
      expect(record).to.not.have.any.keys(
        "content",
        "contentType",
        "hash",
        "contentHash",
      );
    });

    it("should include size when content is requested", async () => {
      const response = await client.get("/test-stream?fields=content,name", {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      expect(response.status).to.equal(200);
      expect(response.data.records).to.have.lengthOf(2);

      const record = response.data.records[0];
      expect(record).to.have.all.keys("content", "name", "size");
      expect(record.size).to.exist;
      expect(parseInt(record.size)).to.be.a("number");
    });

    it("should return all fields when fields param is omitted", async () => {
      const response = await client.get("/test-stream", {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      expect(response.status).to.equal(200);
      expect(response.data.records).to.have.lengthOf(2);

      const record = response.data.records[0];
      expect(record).to.have.all.keys(
        "name",
        "path",
        "index",
        "content",
        "contentType",
        "size",
        "contentHash",
        "hash",
        "previousHash",
        "userId",
        "timestamp",
        "headers",
      );
    });

    it("should work with unique mode", async () => {
      const response = await client.get(
        "/test-stream?unique=true&fields=name,content",
        {
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        },
      );

      expect(response.status).to.equal(200);
      expect(response.data.records).to.have.lengthOf(2);

      const record = response.data.records[0];
      expect(record).to.have.all.keys("name", "content", "size");
    });

    it("should handle empty fields parameter", async () => {
      const response = await client.get("/test-stream?fields=", {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      expect(response.status).to.equal(200);
      // Should return all fields when fields is empty
      const record = response.data.records[0];
      expect(record).to.have.property("content");
      expect(record).to.have.property("contentType");
    });

    it("should ignore invalid field names", async () => {
      const response = await client.get(
        "/test-stream?fields=name,invalidField,index",
        {
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        },
      );

      expect(response.status).to.equal(200);
      const record = response.data.records[0];
      expect(record).to.have.all.keys("name", "index");
      expect(record).to.not.have.property("invalidField");
    });
  });

  describe("Content Truncation", () => {
    beforeEach(async () => {
      // Write a record with large content
      const largeContent = "A".repeat(10000);
      await client.post("/test-stream/large-record", largeContent, {
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "text/plain",
        },
      });

      // Write a record with large JSON content
      const largeJson = {
        data: "B".repeat(5000),
        nested: {
          value: "C".repeat(5000),
        },
      };
      await client.post("/test-stream/large-json", largeJson, {
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
        },
      });
    });

    it("should truncate content when maxContentSize is specified", async () => {
      const response = await client.get("/test-stream?maxContentSize=100", {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      expect(response.status).to.equal(200);

      // Find the large-record
      const largeRecord = response.data.records.find(
        (r: any) => r.name === "large-record",
      );
      expect(largeRecord).to.exist;
      expect(largeRecord.content).to.have.lengthOf(100);
      expect(parseInt(largeRecord.size)).to.equal(10000); // Original size preserved
    });

    it("should not truncate content smaller than maxContentSize", async () => {
      // First write a small record
      await client.post("/test-stream/small-record", "Small content", {
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "text/plain",
        },
      });

      const response = await client.get("/test-stream?maxContentSize=1000", {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      expect(response.status).to.equal(200);

      // Find small-record which has small content
      const smallRecord = response.data.records.find(
        (r: any) => r.name === "small-record",
      );
      expect(smallRecord).to.exist;
      expect(smallRecord.content).to.equal("Small content");
      expect(smallRecord.content.length).to.be.lessThan(1000);
    });

    it("should work with field selection", async () => {
      const response = await client.get(
        "/test-stream?fields=name,content&maxContentSize=50",
        {
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        },
      );

      expect(response.status).to.equal(200);

      const largeRecord = response.data.records.find(
        (r: any) => r.name === "large-record",
      );
      expect(largeRecord).to.exist;
      expect(largeRecord).to.have.all.keys("name", "content", "size");
      expect(largeRecord.content).to.have.lengthOf(50);
      expect(parseInt(largeRecord.size)).to.equal(10000);
    });

    it("should handle JSON content appropriately", async () => {
      const response = await client.get("/test-stream?maxContentSize=100", {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      expect(response.status).to.equal(200);

      // JSON should be returned as parsed object, not truncated
      const jsonRecord = response.data.records.find(
        (r: any) => r.name === "large-json",
      );
      expect(jsonRecord).to.exist;
      expect(jsonRecord.content).to.be.an("object");
      expect(jsonRecord.content.data).to.exist;
    });

    it("should truncate with unique mode", async () => {
      const response = await client.get(
        "/test-stream?unique=true&maxContentSize=50",
        {
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        },
      );

      expect(response.status).to.equal(200);

      const largeRecord = response.data.records.find(
        (r: any) => r.name === "large-record",
      );
      expect(largeRecord).to.exist;
      expect(largeRecord.content).to.have.lengthOf(50);
      expect(parseInt(largeRecord.size)).to.equal(10000);
    });

    it("should handle invalid maxContentSize gracefully", async () => {
      const response = await client.get("/test-stream?maxContentSize=invalid", {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      expect(response.status).to.equal(200);
      // Should ignore invalid maxContentSize and return full content
      const largeRecord = response.data.records.find(
        (r: any) => r.name === "large-record",
      );
      expect(largeRecord).to.exist;
      expect(largeRecord.content).to.have.lengthOf(10000);
    });

    it("should handle negative maxContentSize as no truncation", async () => {
      const response = await client.get("/test-stream?maxContentSize=-1", {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      expect(response.status).to.equal(200);
      // Should not truncate with negative value
      const largeRecord = response.data.records.find(
        (r: any) => r.name === "large-record",
      );
      expect(largeRecord).to.exist;
      expect(largeRecord.content).to.have.lengthOf(10000);
    });
  });

  describe("Recursive Mode Support", () => {
    beforeEach(async () => {
      // Create nested streams and records
      await client.post(
        "/nested/stream1",
        {},
        {
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        },
      );

      await client.post(
        "/nested/stream2",
        {},
        {
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        },
      );

      await client.post(
        "/nested/stream1/nested-record1",
        "Content in nested stream 1",
        {
          headers: {
            Authorization: `Bearer ${authToken}`,
            "Content-Type": "text/plain",
          },
        },
      );

      await client.post("/nested/stream2/nested-record2", "X".repeat(1000), {
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "text/plain",
        },
      });
    });

    it("should apply field selection in recursive mode", async () => {
      const response = await client.get(
        "/nested?recursive=true&fields=name,path",
        {
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        },
      );

      expect(response.status).to.equal(200);
      expect(response.data.records.length).to.be.greaterThan(0);

      response.data.records.forEach((record: any) => {
        expect(record).to.have.all.keys("name", "path");
        expect(record).to.not.have.property("content");
      });
    });

    it("should apply content truncation in recursive mode", async () => {
      const response = await client.get(
        "/nested?recursive=true&maxContentSize=10",
        {
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        },
      );

      expect(response.status).to.equal(200);

      const nestedRecord2 = response.data.records.find(
        (r: any) => r.name === "nested-record2",
      );
      expect(nestedRecord2).to.exist;
      expect(nestedRecord2.content).to.have.lengthOf(10);
      expect(parseInt(nestedRecord2.size)).to.equal(1000);
    });

    it("should combine fields and maxContentSize in recursive unique mode", async () => {
      const response = await client.get(
        "/nested?recursive=true&unique=true&fields=name,content&maxContentSize=5",
        {
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        },
      );

      expect(response.status).to.equal(200);

      response.data.records.forEach((record: any) => {
        expect(record).to.have.all.keys("name", "content", "size");
        if (record.name === "nested-record2") {
          expect(record.content).to.have.lengthOf(5);
          expect(parseInt(record.size)).to.equal(1000);
        }
      });
    });
  });
});
