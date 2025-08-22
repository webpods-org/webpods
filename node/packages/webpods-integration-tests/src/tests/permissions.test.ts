// Permission tests for WebPods
import { expect } from "chai";
import {
  TestHttpClient,
  createTestUser,
  createTestPod,
} from "webpods-test-utils";
import { testDb } from "../test-setup.js";

describe("WebPods Permissions", () => {
  let client: TestHttpClient;
  let user1: any;
  let user1Token: string;
  let user2: any;
  let user2Id: string;
  let user2Token: string;
  const testPodId = "perm-test";
  const baseUrl = `http://${testPodId}.localhost:3000`;

  beforeEach(async () => {
    client = new TestHttpClient("http://localhost:3000");
    const db = testDb.getDb();

    // Create two test users
    user1 = await createTestUser(db, {
      provider: "testprovider2",
      providerId: "user1",
      email: "user1@example.com",
      name: "User One",
    });

    user2 = await createTestUser(db, {
      provider: "testprovider2",
      providerId: "user2",
      email: "user2@example.com",
      name: "User Two",
    });

    user2Id = user2.userId;

    // Create the test pod (owned by user1)
    await createTestPod(db, testPodId, user1.userId);

    // Get OAuth tokens for both users
    user1Token = await client.authenticateViaOAuth(user1.userId, [testPodId]);
    user2Token = await client.authenticateViaOAuth(user2.userId, [testPodId]);

    client.setBaseUrl(baseUrl);
  });

  describe("Private Streams", () => {
    it("should only allow creator to read private stream", async () => {
      // User1 creates private stream
      client.setAuthToken(user1Token);
      await client.post(
        "/private-read/secret?access=private",
        "Secret message",
      );

      // User1 can read
      const response1 = await client.get("/private-read?i=0");
      expect(response1.status).to.equal(200);
      expect(response1.data).to.equal("Secret message");

      // User2 cannot read
      client.setAuthToken(user2Token);
      const response2 = await client.get("/private-read?i=0");
      expect(response2.status).to.equal(403);
      expect(response2.data.error.code).to.equal("FORBIDDEN");

      // Anonymous cannot read
      client.clearAuthToken();
      client.clearCookies();
      const response3 = await client.get("/private-read?i=0");
      expect(response3.status).to.equal(403);
    });

    it("should only allow creator to write to private stream", async () => {
      // User1 creates private stream
      client.setAuthToken(user1Token);
      await client.post("/private-write/first?access=private", "First message");

      // User2 cannot write
      client.setAuthToken(user2Token);
      const response = await client.post(
        "/private-write/attempt",
        "Attempt to write",
      );
      expect(response.status).to.equal(403);
      expect(response.data.error.code).to.equal("FORBIDDEN");

      // User1 can write more
      client.setAuthToken(user1Token);
      const response2 = await client.post(
        "/private-write/second",
        "Second message",
      );
      expect(response2.status).to.equal(201);
      expect(response2.data.index).to.equal(1);
    });
  });

  describe("Public Streams", () => {
    it("should allow anyone to read public stream", async () => {
      // User1 creates public stream
      client.setAuthToken(user1Token);
      await client.post("/public-stream/public", "Public message");

      // User2 can read
      client.setAuthToken(user2Token);
      const response1 = await client.get("/public-stream?i=0");
      expect(response1.status).to.equal(200);

      // Anonymous can read
      client.clearAuthToken();
      const response2 = await client.get("/public-stream?i=0");
      expect(response2.status).to.equal(200);
    });

    it("should allow any authenticated user to write to public stream", async () => {
      // User1 creates public stream
      client.setAuthToken(user1Token);
      await client.post("/public-write/msg1", "Message 1");

      // User2 can write
      client.setAuthToken(user2Token);
      const response = await client.post("/public-write/msg2", "Message 2");
      expect(response.status).to.equal(201);

      // Verify both messages exist
      const list = await client.get("/public-write");
      expect(list.data.records).to.have.lengthOf(2);

      // Anonymous cannot write
      client.clearAuthToken();
      const response2 = await client.post(
        "/public-write/anon",
        "Anonymous attempt",
      );
      expect(response2.status).to.equal(401);
    });
  });

  describe("Permission Streams (Allow/Deny Lists)", () => {
    it("should support permission streams for access control", async () => {
      client.setAuthToken(user1Token);

      // Create permission stream with user2 allowed to read but not write
      await client.post("/members/perms", {
        id: user2Id,
        read: true,
        write: false,
      });

      // Create stream with permission-based access
      await client.post(
        "/restricted/content1?access=/members",
        "Restricted content",
      );

      // User2 can read (has read permission)
      client.setAuthToken(user2Token);
      const response1 = await client.get("/restricted?i=0");
      expect(response1.status).to.equal(200);

      // User2 cannot write (no write permission)
      const response2 = await client.post("/restricted/fail", "Should fail");
      expect(response2.status).to.equal(403);

      // User1 can read and write (creator always has access)
      client.setAuthToken(user1Token);
      const response3 = await client.get("/restricted?i=0");
      expect(response3.status).to.equal(200);
      const response4 = await client.post(
        "/restricted/creator",
        "Creator can write",
      );
      expect(response4.status).to.equal(201);

      // Anonymous cannot read or write
      client.clearAuthToken();
      const response5 = await client.get("/restricted?i=0");
      expect(response5.status).to.equal(403);
    });
  });

  describe("Pod Ownership", () => {
    it("should transfer pod ownership via .meta/owner", async () => {
      // User1 creates pod
      client.setAuthToken(user1Token);
      await client.post("/test/init", "Create pod");

      // Transfer ownership to user2
      const response = await client.post("/.meta/owner", { owner: user2Id });
      expect(response.status).to.equal(201);

      // User2 is now owner and can update .meta/ streams
      client.setAuthToken(user2Token);
      const response2 = await client.post("/.meta/links", { "/": "homepage" });
      expect(response2.status).to.equal(201);

      // User1 can no longer update .meta/ streams
      client.setAuthToken(user1Token);
      const response3 = await client.post("/.meta/links", {
        "/about": "about",
      });
      expect(response3.status).to.equal(403);
    });

    it("should only allow current owner to transfer ownership", async () => {
      // User1 creates pod
      client.setAuthToken(user1Token);
      await client.post("/test/init", "Create pod");

      // User2 cannot transfer ownership
      client.setAuthToken(user2Token);
      const response = await client.post("/.meta/owner", { owner: user2Id });
      expect(response.status).to.equal(403);
      expect(response.data.error.code).to.equal("FORBIDDEN");
    });
  });

  describe("Stream Permission Updates", () => {
    it("should allow creator to update stream permissions", async () => {
      // User1 creates stream with default (public) permissions
      client.setAuthToken(user1Token);
      await client.post("/perm-update/initial", "Initial");

      // Verify initial permissions are public
      const db = testDb.getDb();
      const pod = await db.oneOrNone(
        `SELECT * FROM pod WHERE pod_id = $(podId)`,
        { podId: testPodId },
      );
      let stream = await db.oneOrNone(
        `SELECT * FROM stream WHERE pod_id = $(podId) AND stream_id = $(streamId)`,
        { podId: pod.id, streamId: "perm-update" },
      );
      expect(stream.access_permission).to.equal("public");

      // User2 can read the public stream
      client.setAuthToken(user2Token);
      let readResponse = await client.get("/perm-update/initial");
      expect(readResponse.status).to.equal(200);

      // User1 updates permissions to private
      client.setAuthToken(user1Token);
      const response = await client.post(
        "/perm-update/updated?access=private",
        "Updated",
      );
      expect(response.status).to.equal(201);

      // Verify permissions were actually updated
      stream = await db.oneOrNone(
        `SELECT * FROM stream WHERE pod_id = $(podId) AND stream_id = $(streamId)`,
        { podId: pod.id, streamId: "perm-update" },
      );
      expect(stream.access_permission).to.equal("private");

      // User2 can no longer read the now-private stream
      client.setAuthToken(user2Token);
      readResponse = await client.get("/perm-update/updated");
      expect(readResponse.status).to.equal(403);

      // User1 can still read their own private stream
      client.setAuthToken(user1Token);
      readResponse = await client.get("/perm-update/updated");
      expect(readResponse.status).to.equal(200);
    });

    it("should prevent non-creator from updating stream permissions", async () => {
      // User1 creates stream
      client.setAuthToken(user1Token);
      await client.post("/perm-noncreator/initial", "Initial");

      // Verify initial permissions are public
      const db = testDb.getDb();
      const pod = await db.oneOrNone(
        `SELECT * FROM pod WHERE pod_id = $(podId)`,
        { podId: testPodId },
      );
      let stream = await db.oneOrNone(
        `SELECT * FROM stream WHERE pod_id = $(podId) AND stream_id = $(streamId)`,
        { podId: pod.id, streamId: "perm-noncreator" },
      );
      expect(stream.access_permission).to.equal("public");

      // User2 tries to update permissions (should be ignored)
      client.setAuthToken(user2Token);
      const response = await client.post(
        "/perm-noncreator/attempt?access=private",
        "Attempt to change permissions",
      );
      expect(response.status).to.equal(201); // Write succeeds

      // But permissions should remain unchanged
      stream = await db.oneOrNone(
        `SELECT * FROM stream WHERE pod_id = $(podId) AND stream_id = $(streamId)`,
        { podId: pod.id, streamId: "perm-noncreator" },
      );
      expect(stream.access_permission).to.equal("public"); // Still public
    });
  });

  describe("Complex Permission Scenarios", () => {
    it("should handle nested stream paths with permissions", async () => {
      client.setAuthToken(user1Token);

      // Create private blog posts
      await client.post("/blog/private/draft1?access=private", "Draft post");
      await client.post("/blog/public/published1", "Published post");

      // User2 cannot read private
      client.setAuthToken(user2Token);
      const response1 = await client.get("/blog/private/draft1");
      expect(response1.status).to.equal(403);

      // But can read public
      const response2 = await client.get("/blog/public/published1");
      expect(response2.status).to.equal(200);
    });

    it("should respect permissions on named content", async () => {
      client.setAuthToken(user1Token);

      // Create private stream with name
      await client.post("/secrets/topsecret?access=private", "Classified");

      // User2 cannot read via name
      client.setAuthToken(user2Token);
      const response = await client.get("/secrets/topsecret");
      expect(response.status).to.equal(403);

      // User1 can read via name
      client.setAuthToken(user1Token);
      const response2 = await client.get("/secrets/topsecret");
      expect(response2.status).to.equal(200);
      expect(response2.data).to.equal("Classified");
    });

    it("should handle permission stream updates correctly", async () => {
      client.setAuthToken(user1Token);

      // Create permission stream
      await client.post("/members/perms1", {
        id: user2Id,
        read: true,
        write: false,
      });

      // Create restricted stream
      await client.post(
        "/member-only/content1?access=/members",
        "Members content",
      );

      // User2 can read
      client.setAuthToken(user2Token);
      let response = await client.get("/member-only?i=0");
      expect(response.status).to.equal(200);

      // User1 updates permission to revoke user2's access
      client.setAuthToken(user1Token);
      await client.post("/members/perms2", {
        id: user2Id,
        read: false,
        write: false,
      });

      // User2 can no longer read (last-write-wins)
      client.setAuthToken(user2Token);
      response = await client.get("/member-only?i=0");
      expect(response.status).to.equal(403);
    });
  });
});
