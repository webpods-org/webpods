import { describe, it, beforeEach } from "mocha";
import { expect } from "chai";
import {
  TestHttpClient,
  createTestUser,
  createTestPod,
  generateTestWebPodsToken,
} from "webpods-test-utils";
import { testDb } from "../test-setup.js";
import { randomUUID } from "crypto";

describe("Schema Validation", () => {
  let client: TestHttpClient;
  let testPodId: string;
  let testUserId: string;

  beforeEach(async () => {
    testUserId = randomUUID();
    testPodId = `schema-${Date.now()}`;

    // Create user first, then pod
    const user = await createTestUser(testDb.getDb());
    testUserId = user.userId;
    await createTestPod(testDb.getDb(), testPodId, testUserId);

    // Create client and auth with WebPods JWT token
    client = new TestHttpClient("http://localhost:3000");
    client.setBaseUrl(`http://${testPodId}.localhost:3000`);
    const authToken = generateTestWebPodsToken(testUserId);
    client.setAuthToken(authToken);
  });

  describe("Basic Schema Validation", () => {
    it("should allow writes when no schema is defined", async () => {
      const response = await client.post("/blog/posts/my-post", {
        title: "Test Post",
        content: "This is a test",
      });

      expect(response.status).to.equal(201);
    });

    it("should validate against JSON schema when enabled", async () => {
      // Enable schema validation
      const schema = {
        schemaType: "json-schema",
        schema: {
          type: "object",
          properties: {
            title: { type: "string", minLength: 1, maxLength: 100 },
            content: { type: "string", minLength: 1 },
            published: { type: "boolean" },
          },
          required: ["title", "content"],
        },
      };

      // Write schema to .config/schema
      const schemaResponse = await client.post(
        "/api/articles/.config/schema",
        schema,
      );
      expect(schemaResponse.status).to.equal(201);

      // Valid write should succeed
      const validResponse = await client.post("/api/articles/article1", {
        title: "Valid Article",
        content: "This article has all required fields",
        published: true,
      });
      expect(validResponse.status).to.equal(201);

      // Invalid write should fail - missing required field
      const invalidResponse = await client.post("/api/articles/article2", {
        title: "Invalid Article",
        // missing 'content' field
      });
      expect(invalidResponse.status).to.equal(400);
      const errorData = invalidResponse.data;
      expect(errorData.error.code).to.equal("VALIDATION_ERROR");
    });

    it("should disable validation when schemaType is none", async () => {
      // Enable schema first
      const schema = {
        schemaType: "json-schema",
        schema: {
          type: "object",
          properties: {
            name: { type: "string", minLength: 1 },
          },
          required: ["name"],
        },
      };

      await client.post("/users/.config/schema", schema);

      // This should fail validation
      let response = await client.post("/users/user1", { age: 25 });
      expect(response.status).to.equal(400);

      // Disable schema
      await client.post("/users/.config/schema", { schemaType: "none" });

      // Now the same write should succeed
      response = await client.post("/users/user2", { age: 25 });
      expect(response.status).to.equal(201);
    });

    it("should validate nested objects", async () => {
      const schema = {
        schemaType: "json-schema",
        schema: {
          type: "object",
          properties: {
            user: {
              type: "object",
              properties: {
                name: { type: "string" },
                email: { type: "string", pattern: "^[^@]+@[^@]+$" },
              },
              required: ["name", "email"],
            },
          },
          required: ["user"],
        },
      };

      await client.post("/profiles/.config/schema", schema);

      // Valid nested structure
      const validResponse = await client.post("/profiles/profile1", {
        user: {
          name: "John Doe",
          email: "john@example.com",
        },
      });
      expect(validResponse.status).to.equal(201);

      // Invalid email format
      const invalidResponse = await client.post("/profiles/profile2", {
        user: {
          name: "Jane Doe",
          email: "not-an-email",
        },
      });
      expect(invalidResponse.status).to.equal(400);
    });

    it("should handle array validation", async () => {
      const schema = {
        schemaType: "json-schema",
        schema: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "number" },
              name: { type: "string" },
            },
            required: ["id", "name"],
          },
          minItems: 1,
        },
      };

      await client.post("/lists/items/.config/schema", schema);

      // Valid array
      const validResponse = await client.post("/lists/items/batch1", [
        { id: 1, name: "Item 1" },
        { id: 2, name: "Item 2" },
      ]);
      expect(validResponse.status).to.equal(201);

      // Empty array (violates minItems)
      const emptyResponse = await client.post("/lists/items/batch2", []);
      expect(emptyResponse.status).to.equal(400);
    });
  });

  describe("Schema Permissions", () => {
    it("should only allow pod owner to set schema", async () => {
      // Create another user
      const otherUser = await createTestUser(testDb.getDb());

      const otherClient = new TestHttpClient("http://localhost:3000");
      otherClient.setBaseUrl(`http://${testPodId}.localhost:3000`);
      const otherAuthToken = generateTestWebPodsToken(otherUser.userId);
      otherClient.setAuthToken(otherAuthToken);

      // Non-owner should not be able to set schema
      const response = await otherClient.post("/protected/.config/schema", {
        schemaType: "json-schema",
        schema: { type: "object" },
      });

      expect(response.status).to.equal(403);
    });
  });

  describe("Edge Cases", () => {
    it("should handle schema on deeply nested streams", async () => {
      const schema = {
        schemaType: "json-schema",
        schema: {
          type: "object",
          properties: {
            level: { type: "number" },
          },
          required: ["level"],
        },
      };

      await client.post("/a/b/c/d/e/.config/schema", schema);

      const response = await client.post("/a/b/c/d/e/record", {
        level: 5,
      });
      expect(response.status).to.equal(201);
    });

    it("should update has_schema flag correctly", async () => {
      // Enable schema
      await client.post("/flagtest/.config/schema", {
        schemaType: "json-schema",
        schema: { type: "object" },
      });

      // Schema should be enforced
      let response = await client.post("/flagtest/record1", "invalid");
      expect(response.status).to.equal(400);

      // Disable schema
      await client.post("/flagtest/.config/schema", {
        schemaType: "none",
      });

      // Schema should not be enforced
      response = await client.post("/flagtest/record2", "any-content");
      expect(response.status).to.equal(201);
    });
  });
});
