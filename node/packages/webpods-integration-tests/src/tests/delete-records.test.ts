// Delete and purge records tests for WebPods
import { expect } from "chai";
import {
  TestHttpClient,
  createTestUser,
  createTestPod,
} from "webpods-test-utils";
import { testDb } from "../test-setup.js";

describe("WebPods Record Deletion", () => {
  let client: TestHttpClient;
  let ownerToken: string;
  let nonOwnerToken: string;
  let ownerId: string;
  const testPodId = "test-delete";
  const baseUrl = `http://${testPodId}.localhost:3000`;

  beforeEach(async () => {
    client = new TestHttpClient("http://localhost:3000");

    // Create pod owner
    const db = testDb.getDb();
    const owner = await createTestUser(db, {
      provider: "test-auth-provider-1",
      providerId: "owner",
      email: "owner@example.com",
      name: "Pod Owner",
    });
    ownerId = owner.userId;

    // Create non-owner user
    const nonOwner = await createTestUser(db, {
      provider: "test-auth-provider-1",
      providerId: "other",
      email: "other@example.com",
      name: "Other User",
    });

    // Create pod as owner
    await createTestPod(db, testPodId, ownerId);

    // Get OAuth tokens
    ownerToken = await client.authenticateViaOAuth(ownerId, [testPodId]);
    nonOwnerToken = await client.authenticateViaOAuth(nonOwner.userId, [
      testPodId,
    ]);

    client.setBaseUrl(baseUrl);

    // Initialize with a first record
    client.setAuthToken(ownerToken);
    await client.createStream("init");
    await client.post("/init/start", "Initialize pod");
  });

  describe("Soft Delete (Tombstone)", () => {
    it("should allow pod owner to soft delete a record", async () => {
      // Create a record
      client.setAuthToken(ownerToken);
      await client.createStream("documents");
      await client.post("/documents/report", "Sensitive report content");

      // Verify it exists
      let response = await client.get("/documents/report");
      expect(response.status).to.equal(200);
      expect(response.data).to.equal("Sensitive report content");

      // Soft delete it
      response = await client.delete("/documents/report");
      // Check delete response
      expect(response.status).to.equal(204);

      // Verify it returns 404
      response = await client.get("/documents/report");
      expect(response.status).to.equal(404);
      expect(response.data.error.code).to.equal("RECORD_DELETED");

      // Verify the tombstone record exists in database
      const db = testDb.getDb();
      const pod = await db.oneOrNone(
        `SELECT * FROM pod WHERE name = $(podId)`,
        { podId: testPodId },
      );

      // Find the stream using hierarchical structure
      const stream = await db.oneOrNone(
        `SELECT * FROM stream WHERE pod_name = $(pod_name) AND name = $(streamName) AND parent_id IS NULL`,
        { pod_name: pod.name, streamName: "documents" },
      );

      // Check for tombstone record using stream_id
      const tombstones = await db.manyOrNone(
        `SELECT * FROM record 
         WHERE stream_id = $(streamId)
         AND name LIKE 'report.deleted.%'
         ORDER BY index DESC`,
        { streamId: stream.id },
      );

      expect(tombstones).to.have.lengthOf(1);
      const tombstone = JSON.parse(tombstones[0].content);
      expect(tombstone).to.have.property("deleted", true);
      expect(tombstone).to.have.property("deletedAt");
      expect(tombstone).to.have.property("deletedBy", ownerId);
      expect(tombstone).to.have.property("originalName", "report");
    });

    it("should prevent non-owner from deleting records", async () => {
      // Create a record as owner (documents stream already created)
      client.setAuthToken(ownerToken);
      await client.post("/documents/public", "Public content");

      // Try to delete as non-owner
      client.setAuthToken(nonOwnerToken);
      const response = await client.delete("/documents/public");
      expect(response.status).to.equal(403);
      expect(response.data.error.code).to.equal("FORBIDDEN");
      expect(response.data.error.message).to.include("Only pod owner");
    });

    it("should return 404 when deleting non-existent record", async () => {
      client.setAuthToken(ownerToken);
      const response = await client.delete("/documents/nonexistent");
      expect(response.status).to.equal(404);
    });

    it("should handle index access to deleted records", async () => {
      client.setAuthToken(ownerToken);

      // Create stream and record
      await client.createStream("data");
      await client.post("/data/item1", "Content 1");
      await client.delete("/data/item1");

      // Try to access by index
      const response = await client.get("/data?i=-1");
      expect(response.status).to.equal(404);
      expect(response.data.error.code).to.equal("RECORD_DELETED");
    });
  });

  describe("Hard Delete (Purge)", () => {
    it("should allow pod owner to purge a record", async () => {
      // Create a record with sensitive data
      client.setAuthToken(ownerToken);
      await client.createStream("secrets", "private");
      await client.post("/secrets/password", "super-secret-password-123");

      // Verify it exists
      let response = await client.get("/secrets/password");
      expect(response.status).to.equal(200);
      expect(response.data).to.equal("super-secret-password-123");

      // Purge it
      response = await client.delete("/secrets/password?purge=true");
      expect(response.status).to.equal(204);

      // Verify it returns 404
      response = await client.get("/secrets/password");
      expect(response.status).to.equal(404);
      expect(response.data.error.code).to.equal("RECORD_DELETED");

      // Verify the content was physically deleted but hash preserved
      const db = testDb.getDb();
      const pod = await db.oneOrNone(
        `SELECT * FROM pod WHERE name = $(podId)`,
        { podId: testPodId },
      );
      const stream = await db.oneOrNone(
        `SELECT * FROM stream WHERE pod_name = $(pod_name) AND name = $(streamId) AND parent_id IS NULL`,
        { pod_name: pod.name, streamId: "secrets" },
      );
      const record = await db.oneOrNone(
        `SELECT * FROM record WHERE stream_id = $(stream_id) AND name = $(name)`,
        { stream_id: stream.id, name: "password" },
      );

      expect(record).to.exist;
      const content = JSON.parse(record.content);
      expect(content).to.have.property("deleted", true);
      expect(content).to.have.property("purged", true);
      expect(content).to.have.property("purgedAt");
      expect(content).to.have.property("purgedBy", ownerId);
      // Original content should be gone
      expect(content).to.not.have.property("super-secret-password-123");

      // Hash should still exist
      expect(record.hash).to.exist;
      expect(record.hash).to.not.be.empty;
    });

    it("should prevent non-owner from purging records", async () => {
      // Create a record as owner (documents stream already created)
      client.setAuthToken(ownerToken);
      await client.post("/documents/sensitive", "Sensitive content");

      // Try to purge as non-owner
      client.setAuthToken(nonOwnerToken);
      const response = await client.delete("/documents/sensitive?purge=true");
      expect(response.status).to.equal(403);
      expect(response.data.error.code).to.equal("FORBIDDEN");
    });

    it("should return 404 when purging non-existent record", async () => {
      client.setAuthToken(ownerToken);
      const response = await client.delete("/documents/ghost?purge=true");
      expect(response.status).to.equal(404);
      // Should get the generic not found message since neither stream nor record exists
      expect(response.data.error.message.toLowerCase()).to.include("not found");
    });

    it("should handle deletion and recreation correctly", async () => {
      client.setAuthToken(ownerToken);

      // Create stream and record
      await client.createStream("logs");
      await client.post("/logs/event", "Event 1");

      // Soft delete it
      await client.delete("/logs/event");

      // Verify it's deleted
      let response = await client.get("/logs/event");
      expect(response.status).to.equal(404);

      // Create another with same name (should work since old one is deleted)
      await client.post("/logs/event", "Event 2");

      // Should be accessible again
      response = await client.get("/logs/event");
      // Check get response
      expect(response.status).to.equal(200);
      expect(response.data).to.equal("Event 2");

      // Purge the new one
      await client.delete("/logs/event?purge=true");

      // Verify it's deleted
      response = await client.get("/logs/event");
      expect(response.status).to.equal(404);
    });
  });

  describe("Stream vs Record Deletion", () => {
    it("should prevent creating both a stream and record with same name", async () => {
      client.setAuthToken(ownerToken);

      // First create a record named "config" in /app stream
      await client.createStream("app");
      await client.post("/app/config", "Config record in app stream");

      // Try to create /app/config as a stream by posting to a child path
      // This would require /app/config to be a stream, not a record
      const response = await client.post("/app/config/test", "Test content");
      expect(response.status).to.equal(409); // Conflict
      expect(response.data.error.code).to.equal("NAME_CONFLICT");

      // Verify the record still exists and works
      const getResponse = await client.get("/app/config");
      expect(getResponse.status).to.equal(200);
      expect(getResponse.data).to.equal("Config record in app stream");
    });

    it("should delete record when stream does not exist at full path", async () => {
      client.setAuthToken(ownerToken);

      // Create only app stream with config record
      await client.createStream("app");
      await client.post("/app/config", "Config data");

      // DELETE /app/config should check:
      // 1. Is "app/config" a stream? No
      // 2. Is "app" a stream with record "config"? Yes, delete the record
      const response = await client.delete("/app/config");
      expect(response.status).to.equal(204);

      // Verify record is deleted
      const getResponse = await client.get("/app/config");
      expect(getResponse.status).to.equal(404);
      expect(getResponse.data.error.code).to.equal("RECORD_DELETED");
    });

    it("should prevent deletion of system streams", async () => {
      client.setAuthToken(ownerToken);

      const response = await client.delete("/.config/owner");
      expect(response.status).to.equal(403);
      expect(response.data.error.message).to.include(
        "System streams cannot be deleted",
      );
    });
  });

  describe("Error Messages", () => {
    it("should provide clear error when neither stream nor record exists", async () => {
      client.setAuthToken(ownerToken);

      const response = await client.delete("/foo/bar/baz");
      expect(response.status).to.equal(404);
      expect(response.data.error.code).to.equal("NOT_FOUND");
      expect(response.data.error.message).to.include("Path not found");
    });
  });
});
