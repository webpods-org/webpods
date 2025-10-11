// Root pod tests for WebPods
import { expect } from "chai";
import {
  TestHttpClient,
  createTestUser,
  createTestPod,
  clearAllCache,
} from "webpods-test-utils";
import { testDb } from "../test-setup.js";
import { createSchema } from "@webpods/tinqer";
import { executeSelect } from "@webpods/tinqer-sql-pg-promise";
import type { DatabaseSchema } from "webpods-test-utils";

const schema = createSchema<DatabaseSchema>();

describe("WebPods Root Pod", () => {
  let client: TestHttpClient;
  let userId: string;
  const mainUrl = "http://localhost:3000";
  const rootPodId = "testroot"; // Must match test-config.json
  const rootPodUrl = `http://${rootPodId}.localhost:3000`;

  // Helper to create the root pod with initial content
  async function setupRootPod() {
    const db = testDb.getDb();

    // Check if pod already exists
    const podResults = await executeSelect(
      db,
      schema,
      (q, p) =>
        q
          .from("pod")
          .select((pod) => ({ name: pod.name }))
          .where((pod) => pod.name === p.podId)
          .take(1),
      { podId: rootPodId },
    );
    const existingPod = podResults[0] || null;

    if (!existingPod) {
      await createTestPod(db, rootPodId, userId);
    }

    const podToken = await client.authenticateViaOAuth(userId, [rootPodId]);
    client.setAuthToken(podToken);

    // Only create initial content if pod was just created
    if (!existingPod) {
      // Create streams first
      await client.createStream("pages");
      await client.createStream("api");

      // Create initial content
      await client.post("/pages/home", "<h1>Welcome to WebPods</h1>");
      await client.post("/pages/about", "<h1>About WebPods</h1>");
      await client.post("/api/data", JSON.stringify({ version: "1.0" }));

      // Configure links using the routing API endpoint
      await client.post("/.config/routing", {
        "/": "pages/home",
        "/about": "pages/about",
      });
    }
  }

  beforeEach(async () => {
    await clearAllCache();
    client = new TestHttpClient(mainUrl);

    // Create test user - needs to be in beforeEach since afterEach truncates all tables
    const db = testDb.getDb();
    const user = await createTestUser(db, {
      provider: "test-auth-provider-1",
      providerId: "roottest",
      email: "roottest@example.com",
      name: "Root Test User",
    });
    userId = user.userId;
  });

  afterEach(async () => {
    await clearAllCache();
  });

  describe("With rootPod configured but not existing", () => {
    it("should return 404 on main domain root", async () => {
      const response = await client.get("/");
      expect(response.status).to.equal(404);
      expect(response.data.error.code).to.equal("NOT_FOUND");
    });

    it("should return 404 on main domain paths", async () => {
      const response = await client.get("/some/path");
      expect(response.status).to.equal(404);
      expect(response.data.error.code).to.equal("NOT_FOUND");
    });

    it("should still serve /health on main domain", async () => {
      const response = await client.get("/health");
      expect(response.status).to.equal(200);
      expect(response.data).to.have.property("status", "healthy");
    });

    it("should still serve /auth endpoints on main domain", async () => {
      const response = await client.get("/auth/providers");
      expect(response.status).to.equal(200);
      expect(response.data).to.have.property("providers");
    });
  });

  describe("Root pod functionality", () => {
    it("should serve root pod content when configured", async () => {
      // This tests that the root pod itself works
      client.setBaseUrl(rootPodUrl);
      await setupRootPod();

      const response = await client.get("/");
      expect(response.status).to.equal(200);
      expect(response.data).to.equal("<h1>Welcome to WebPods</h1>");
    });

    it("should serve root pod links", async () => {
      client.setBaseUrl(rootPodUrl);
      await setupRootPod();

      const response = await client.get("/about");
      expect(response.status).to.equal(200);
      expect(response.data).to.equal("<h1>About WebPods</h1>");
    });

    it("should serve root pod streams", async () => {
      client.setBaseUrl(rootPodUrl);
      await setupRootPod();

      const response = await client.get("/pages/home");
      expect(response.status).to.equal(200);
      expect(response.data).to.equal("<h1>Welcome to WebPods</h1>");
    });

    it("should return 404 for non-existent paths in root pod", async () => {
      client.setBaseUrl(rootPodUrl);
      await setupRootPod();

      const response = await client.get("/nonexistent");
      expect(response.status).to.equal(404);
    });

    it("should allow POST to root pod streams", async () => {
      client.setBaseUrl(rootPodUrl);

      // Create the pod first with OAuth authentication
      const db = testDb.getDb();
      // Check if pod exists first
      const podResults = await executeSelect(
        db,
        schema,
        (q, p) =>
          q
            .from("pod")
            .select((pod) => ({ name: pod.name }))
            .where((pod) => pod.name === p.podId)
            .take(1),
        { podId: rootPodId },
      );
      const existingPod = podResults[0] || null;
      if (!existingPod) {
        await createTestPod(db, rootPodId, userId);
      }
      const podToken = await client.authenticateViaOAuth(userId, [rootPodId]);
      client.setAuthToken(podToken);

      // Create stream first
      await client.createStream("pages");

      // Create initial content to establish the pod
      await client.post("/pages/home", "<h1>Welcome to WebPods</h1>");

      // Now test creating new content
      const response = await client.post("/pages/new", "New page content");
      expect(response.status).to.equal(201);

      // Verify it was created
      const getResponse = await client.get("/pages/new");
      expect(getResponse.status).to.equal(200);
      expect(getResponse.data).to.equal("New page content");
    });

    it("should serve JSON content correctly", async () => {
      client.setBaseUrl(rootPodUrl);

      // Create the pod and content first
      const db = testDb.getDb();
      // Check if pod exists first
      const podResults = await executeSelect(
        db,
        schema,
        (q, p) =>
          q
            .from("pod")
            .select((pod) => ({ name: pod.name }))
            .where((pod) => pod.name === p.podId)
            .take(1),
        { podId: rootPodId },
      );
      const existingPod = podResults[0] || null;
      if (!existingPod) {
        await createTestPod(db, rootPodId, userId);
      }
      const podToken = await client.authenticateViaOAuth(userId, [rootPodId]);
      client.setAuthToken(podToken);
      // Create stream first
      await client.createStream("api");
      await client.post("/api/data", JSON.stringify({ version: "1.0" }));

      // Now test reading it
      client.setAuthToken(""); // Read without auth
      const response = await client.get("/api/data");
      expect(response.status).to.equal(200);
      // The response should be the raw JSON string we stored
      expect(response.data).to.equal('{"version":"1.0"}');
    });

    it("should respect permissions for root pod", async () => {
      // Create a private stream in root pod
      client.setBaseUrl(rootPodUrl);
      await setupRootPod();

      // setupRootPod already creates pod and gets token, just retrieve it
      const podToken = await client.authenticateViaOAuth(userId, [rootPodId]);
      client.setAuthToken(podToken);
      // Create private stream first
      await client.createStream("private", "private");
      await client.post("/private/secret", "Secret content");

      // Try to access without auth
      client.setAuthToken("");
      const response = await client.get("/private/secret");
      expect(response.status).to.equal(403);

      // Access with auth should work
      client.setAuthToken(podToken);
      const authResponse = await client.get("/private/secret");
      expect(authResponse.status).to.equal(200);
      expect(authResponse.data).to.equal("Secret content");
    });

    it("should allow deletion in root pod", async () => {
      client.setBaseUrl(rootPodUrl);
      await setupRootPod();

      // setupRootPod already creates pod and gets token, just retrieve it
      const podToken = await client.authenticateViaOAuth(userId, [rootPodId]);
      client.setAuthToken(podToken);

      // Create stream first
      await client.createStream("temp");
      // Create and delete a record
      await client.post("/temp/data", "Temporary data");
      const deleteResponse = await client.delete("/temp/data");
      expect(deleteResponse.status).to.equal(204);

      // Should return 404 after deletion
      const getResponse = await client.get("/temp/data");
      expect(getResponse.status).to.equal(404);
      expect(getResponse.data.error.code).to.equal("RECORD_NOT_FOUND");
    });
  });

  describe("Root pod behavior verification", () => {
    it("should not interfere with subdomain pods", async () => {
      // First set up root pod
      client.setBaseUrl(rootPodUrl);
      await setupRootPod();

      // Create another pod
      const alicePodUrl = "http://alice.localhost:3000";
      client.setBaseUrl(alicePodUrl);

      // Use OAuth authentication for alice pod
      const db = testDb.getDb();
      await createTestPod(db, "alice", userId);
      const aliceToken = await client.authenticateViaOAuth(userId, ["alice"]);
      client.setAuthToken(aliceToken);
      // Create streams first
      await client.createStream("init");
      await client.createStream("blog");
      await client.post("/init/start", "Initialize alice pod");
      await client.post("/blog/post1", "Alice blog post");

      // Alice pod should work normally
      const response = await client.get("/blog/post1");
      expect(response.status).to.equal(200);
      expect(response.data).to.equal("Alice blog post");

      // And be completely separate from root pod
      client.setBaseUrl(rootPodUrl);
      const rootResponse = await client.get("/blog/post1");
      expect(rootResponse.status).to.equal(404);
    });

    it("should handle nested paths in root pod", async () => {
      client.setBaseUrl(rootPodUrl);
      await setupRootPod();

      // setupRootPod already creates pod and gets token, just retrieve it
      const podToken = await client.authenticateViaOAuth(userId, [rootPodId]);
      client.setAuthToken(podToken);

      // Create nested streams first
      await client.createStream("docs/api/v1");
      await client.createStream("docs/guides");
      // Create nested stream structure
      await client.post("/docs/api/v1/intro", "API Introduction");
      await client.post("/docs/guides/quickstart", "Quick Start Guide");

      // Should be accessible
      let response = await client.get("/docs/api/v1/intro");
      expect(response.status).to.equal(200);
      expect(response.data).to.equal("API Introduction");

      response = await client.get("/docs/guides/quickstart");
      expect(response.status).to.equal(200);
      expect(response.data).to.equal("Quick Start Guide");
    });
  });
});
