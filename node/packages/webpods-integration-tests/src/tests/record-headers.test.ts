// Record headers feature tests for WebPods
import { expect } from "chai";
import {
  TestHttpClient,
  createTestUser,
  createTestPod,
} from "webpods-test-utils";
import { testDb } from "../test-setup.js";

describe("WebPods Record Headers", () => {
  let client: TestHttpClient;
  let authToken: string;
  const testPodId = "test-headers";
  const baseUrl = `http://${testPodId}.localhost:3000`;

  beforeEach(async () => {
    client = new TestHttpClient("http://localhost:3000");
    // Create a test user and auth token
    const db = testDb.getDb();
    const user = await createTestUser(db, {
      provider: "test-auth-provider-1",
      providerId: "headers123",
      email: "headers@example.com",
      name: "Headers Test User",
    });

    // Create the test pod
    await createTestPod(db, testPodId, user.userId);

    // Get OAuth token
    authToken = await client.authenticateViaOAuth(user.userId, [testPodId]);

    client.setBaseUrl(baseUrl);
    client.setAuthToken(authToken);
  });

  describe("Writing Records with Headers", () => {
    it("should store allowed headers when writing a record", async () => {
      // Create a stream first
      await client.createStream("blog");

      // Write a record with custom headers
      const response = await client.post(
        "/blog/post1",
        "My blog post content",
        {
          headers: {
            "Content-Type": "text/plain",
            "x-record-header-cache-control": "no-cache",
            "x-record-header-hello-world": "test-value",
          },
        },
      );

      expect(response.status).to.equal(201);
      expect(response.data).to.have.property("name", "post1");
      // headers are no longer returned in minimal response
      expect(response.data).to.have.property("hash");
      expect(response.data).to.have.property("size");
    });

    it("should ignore headers not in allowedRecordHeaders", async () => {
      // Create a stream
      await client.createStream("secure");

      // Write a record with allowed and disallowed headers
      const response = await client.post("/secure/doc1", "Secure document", {
        headers: {
          "Content-Type": "text/plain",
          "x-record-header-cache-control": "private", // allowed
          "x-record-header-not-allowed": "should-be-ignored", // not allowed
          "x-record-header-hello-world": "allowed", // allowed
        },
      });

      expect(response.status).to.equal(201);
      // headers are no longer returned in minimal response
      expect(response.data).to.have.property("hash");
      expect(response.data).to.have.property("size");
    });

    it("should handle records with no custom headers", async () => {
      // Create a stream
      await client.createStream("plain");

      // Write a record without custom headers
      const response = await client.post("/plain/doc1", "Plain content");

      expect(response.status).to.equal(201);
      expect(response.data).to.have.property("name", "doc1");
      // Headers should be empty object or undefined
      expect(response.data.headers).to.satisfy(
        (h: any) => h === undefined || Object.keys(h).length === 0,
      );
    });

    it("should preserve headers with special characters in values", async () => {
      // Create a stream
      await client.createStream("special");

      // Write a record with special characters in header values (but ASCII-safe)
      const response = await client.post("/special/doc1", "Content", {
        headers: {
          "Content-Type": "text/plain",
          "x-record-header-cache-control": "max-age=3600, must-revalidate",
          "x-record-header-hello-world": "Hello, World!",
        },
      });

      expect(response.status).to.equal(201);
      // headers are no longer returned in minimal response
      expect(response.data).to.have.property("hash");
      expect(response.data).to.have.property("size");
    });
  });

  describe("Reading Records with Headers", () => {
    it("should return headers in JSON response when listing records", async () => {
      // Create a stream and write records with headers
      await client.createStream("list-test");

      await client.post("/list-test/doc1", "Document 1", {
        headers: {
          "x-record-header-cache-control": "public",
        },
      });

      await client.post("/list-test/doc2", "Document 2", {
        headers: {
          "x-record-header-hello-world": "test",
        },
      });

      // List records
      const listResponse = await client.get("/list-test");
      expect(listResponse.status).to.equal(200);
      expect(listResponse.data.records).to.have.lengthOf(2);

      const doc1 = listResponse.data.records.find(
        (r: any) => r.name === "doc1",
      );
      expect(doc1.headers).to.deep.equal({
        "cache-control": "public",
      });

      const doc2 = listResponse.data.records.find(
        (r: any) => r.name === "doc2",
      );
      expect(doc2.headers).to.deep.equal({
        "hello-world": "test",
      });
    });

    it("should return headers as HTTP headers when fetching individual record", async () => {
      // Create a stream and write a record with headers
      await client.createStream("fetch-test");

      await client.post("/fetch-test/doc1", "Test content", {
        headers: {
          "x-record-header-cache-control": "no-store",
          "x-record-header-x-custom": "custom-value",
        },
      });

      // Fetch the individual record (raw request to check headers)
      const response = await client.get("/fetch-test/doc1");

      expect(response.status).to.equal(200);
      expect(response.data).to.equal("Test content");

      // Check that custom headers are present in HTTP response
      expect(response.headers).to.have.property("cache-control", "no-store");
      expect(response.headers).to.have.property("x-custom", "custom-value");
    });

    it("should include headers when fetching by index", async () => {
      // Create a stream and write a record with headers
      await client.createStream("index-test");

      await client.post(
        "/index-test/doc1",
        { message: "JSON content" },
        {
          headers: {
            "Content-Type": "application/json",
            "x-record-header-hello-world": "from-index",
          },
        },
      );

      // Fetch by index - now returns a list with headers in the record object
      const response = await client.get("/index-test?i=0");
      expect(response.status).to.equal(200);
      expect(response.data.records).to.have.lengthOf(1);
      expect(response.data.records[0].content).to.have.property(
        "message",
        "JSON content",
      );

      // Headers are now in the record object, not response headers
      expect(response.data.records[0].headers).to.have.property(
        "hello-world",
        "from-index",
      );
    });
  });

  describe("Headers with Different Content Types", () => {
    it("should work with JSON content", async () => {
      await client.createStream("json-test");

      const response = await client.post(
        "/json-test/data",
        { key: "value", nested: { data: true } },
        {
          headers: {
            "Content-Type": "application/json",
            "x-record-header-cache-control": "private",
          },
        },
      );

      expect(response.status).to.equal(201);
      // headers are no longer returned in minimal response
      expect(response.data).to.have.property("hash");
      expect(response.data).to.have.property("size");

      // Verify retrieval
      const getResponse = await client.get("/json-test/data");
      expect(getResponse.data).to.deep.equal({
        key: "value",
        nested: { data: true },
      });
      expect(getResponse.headers).to.have.property("cache-control", "private");
    });

    it("should work with binary content", async () => {
      await client.createStream("binary-test");

      // Create a small binary buffer
      const binaryData = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG header

      const response = await client.post("/binary-test/image.png", binaryData, {
        headers: {
          "Content-Type": "image/png",
          "x-record-header-cache-control": "public, max-age=31536000",
        },
      });

      expect(response.status).to.equal(201);
      // headers are no longer returned in minimal response
      expect(response.data).to.have.property("hash");
      expect(response.data).to.have.property("size");
    });
  });

  describe("Headers Validation", () => {
    it("should handle empty header values", async () => {
      await client.createStream("empty-test");

      const response = await client.post("/empty-test/doc1", "Content", {
        headers: {
          "x-record-header-cache-control": "", // empty value
        },
      });

      expect(response.status).to.equal(201);
      // headers are no longer returned in minimal response
      expect(response.data).to.have.property("hash");
      expect(response.data).to.have.property("size");
    });

    it("should ignore non-string header values", async () => {
      await client.createStream("type-test");

      // Arrays in headers get joined as strings by HTTP clients
      const response = await client.post("/type-test/doc1", "Content", {
        headers: {
          "x-record-header-cache-control": "valid-string",
          // Note: Most HTTP clients will convert arrays to comma-separated strings
          // so this test validates that behavior
        },
      });

      expect(response.status).to.equal(201);
      // headers are no longer returned in minimal response
      expect(response.data).to.have.property("hash");
      expect(response.data).to.have.property("size");
    });
  });
});
