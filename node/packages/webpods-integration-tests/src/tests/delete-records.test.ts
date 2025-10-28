// Delete and purge records tests for WebPods
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

describe("WebPods Record Deletion", () => {
  let client: TestHttpClient;
  let ownerToken: string;
  let nonOwnerToken: string;
  let ownerId: string;
  const testPodId = "test-delete";
  const baseUrl = `http://${testPodId}.localhost:3000`;

  beforeEach(async () => {
    await clearAllCache();
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

  afterEach(async () => {
    await clearAllCache();
  });

  describe("Soft Delete (Deletion Marker)", () => {
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

      // Verify it returns 404 (deleted records are invisible)
      response = await client.get("/documents/report");
      expect(response.status).to.equal(404);
      // getRecord returns a generic error, check that we have an error
      expect(response.data).to.have.property("error");

      // Verify the deletion marker record exists in database
      const db = testDb.getDb();
      const podResults = await executeSelect(
        db,
        schema,
        (q, p) =>
          q
            .from("pod")
            .where((pod) => pod.name === p.podId)
            .take(1),
        { podId: testPodId },
      );
      const pod = podResults[0] || null;

      // Find the stream using hierarchical structure
      const streamResults = await executeSelect(
        db,
        schema,
        (q, p) =>
          q
            .from("stream")
            .where(
              (s) =>
                s.pod_name === p.pod_name &&
                s.name === p.streamName &&
                s.parent_id === null,
            )
            .take(1),
        { pod_name: pod.name, streamName: "documents" },
      );
      const stream = streamResults[0] || null;

      // Check for deletion record using stream_id
      const deletionRecords = await executeSelect(
        db,
        schema,
        (q, p) =>
          q
            .from("record")
            .where(
              (r) =>
                r.stream_id === p.streamId &&
                r.name === "report" &&
                r.deleted === true,
            )
            .orderByDescending((r) => r.index),
        { streamId: stream.id },
      );

      expect(deletionRecords).to.have.lengthOf(1);
      // Deletion records now have empty content, not metadata
      expect(deletionRecords[0].content).to.equal("");
      expect(deletionRecords[0].deleted).to.be.true;
      expect(deletionRecords[0].user_id).to.equal(ownerId);
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

      // Try to access by index - deleted record is included in the list (append-only log)
      const response = await client.get("/data?i=-1");
      expect(response.status).to.equal(200);
      expect(response.data.records).to.have.lengthOf(1);
      // The deleted record should still be in the list (it's a deletion marker)
      expect(response.data.records[0].content).to.equal("");
      expect(response.data.records[0].name).to.equal("item1");
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

      // Verify it returns 404 (purged records are invisible)
      response = await client.get("/secrets/password");
      expect(response.status).to.equal(404);
      expect(response.data).to.have.property("error");

      // Verify the content was physically deleted but hash preserved
      const db = testDb.getDb();
      const podResults = await executeSelect(
        db,
        schema,
        (q, p) =>
          q
            .from("pod")
            .where((pod) => pod.name === p.podId)
            .take(1),
        { podId: testPodId },
      );
      const pod = podResults[0] || null;

      const streamResults = await executeSelect(
        db,
        schema,
        (q, p) =>
          q
            .from("stream")
            .where(
              (s) =>
                s.pod_name === p.pod_name &&
                s.name === p.streamId &&
                s.parent_id === null,
            )
            .take(1),
        { pod_name: pod.name, streamId: "secrets" },
      );
      const stream = streamResults[0] || null;

      const recordResults = await executeSelect(
        db,
        schema,
        (q, p) =>
          q
            .from("record")
            .where((r) => r.stream_id === p.stream_id && r.name === p.name)
            .take(1),
        { stream_id: stream.id, name: "password" },
      );
      const record = recordResults[0] || null;

      expect(record).to.exist;
      // Content should be empty after purge
      expect(record.content).to.equal("");
      expect(record.purged).to.be.true;
      // Original content should be gone
      expect(record.content).to.not.include("super-secret-password-123");

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

      // Verify record is deleted (invisible)
      const getResponse = await client.get("/app/config");
      expect(getResponse.status).to.equal(404);
      expect(getResponse.data).to.have.property("error");
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
