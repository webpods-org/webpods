/**
 * CLI Pod Management Commands Tests
 */

import { expect } from "chai";
import { randomUUID } from "crypto";
import { CliTestHelper } from "../cli-test-helpers.js";
import {
  setupCliTests,
  cleanupCliTests,
  resetCliTestDb,
  testToken,
  testUser,
  testDb,
} from "../test-setup.js";
import {
  createOwnerConfig,
  createStreamWithRecord,
} from "../utils/test-data-helpers.js";
import { createSchema } from "@webpods/tinqer";
import { executeInsert, executeSelect } from "@webpods/tinqer-sql-pg-promise";
import type { DatabaseSchema } from "webpods-test-utils";

const schema = createSchema<DatabaseSchema>();

describe("CLI Pod Commands", function () {
  this.timeout(30000);

  let cli: CliTestHelper;

  before(async () => {
    await setupCliTests();
    cli = new CliTestHelper();
    await cli.setup();
  });

  after(async () => {
    await cli.cleanup();
    await cleanupCliTests();
  });

  beforeEach(async () => {
    await resetCliTestDb();
  });

  describe("create command", () => {
    it("should create a new pod", async () => {
      // Skip for now - pod creation in WebPods is implicit when writing
      // The CLI needs a different approach or the server needs an explicit API
      const result = await cli.exec(["pod", "create", "test-pod"], {
        token: testToken,
      });

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include("Pod 'test-pod' created successfully");

      // Verify pod was created in database
      const podResults = await executeSelect(
        testDb.getDb(),
        schema,
        (q, p) =>
          q
            .from("pod")
            .where((pod) => pod.name === p.name)
            .take(1),
        {
          name: "test-pod",
        },
      );
      const pod = podResults[0] || null;
      expect(pod).to.not.be.null;

      // Verify ownership via .config/owner stream
      // First get the .config stream
      const configStreamResults = await executeSelect(
        testDb.getDb(),
        schema,
        (q) =>
          q
            .from("stream")
            .where(
              (s) =>
                s.pod_name === "test-pod" &&
                s.name === ".config" &&
                s.parent_id === null,
            )
            .select((s) => ({ id: s.id }))
            .take(1),
        {},
      );
      // Then get the owner stream
      const ownerStreamResults =
        configStreamResults.length > 0
          ? await executeSelect(
              testDb.getDb(),
              schema,
              (q, p) =>
                q
                  .from("stream")
                  .where(
                    (s) => s.parent_id === p.configId && s.name === "owner",
                  )
                  .select((s) => ({ id: s.id }))
                  .take(1),
              { configId: configStreamResults[0]!.id },
            )
          : [];
      // Finally get the record from the owner stream
      const ownerRecordResults =
        ownerStreamResults.length > 0
          ? await executeSelect(
              testDb.getDb(),
              schema,
              (q, p) =>
                q.from("record").where((r) => r.stream_id === p.streamId),
              { streamId: ownerStreamResults[0]!.id },
            )
          : [];
      const ownerRecord = ownerRecordResults[0] || null;
      expect(ownerRecord).to.not.be.null;
      const ownerContent = JSON.parse(ownerRecord!.content);
      expect(ownerContent.userId).to.equal(testUser.userId);
    });

    it("should reject invalid pod names", async () => {
      const result = await cli.exec(["pod", "create", "Test-Pod"], {
        token: testToken,
      });

      expect(result.exitCode).to.not.equal(0);
      expect(result.stderr).to.include("Invalid pod name");
    });

    it("should reject duplicate pod names", async () => {
      // Create first pod
      await cli.exec(["pod", "create", "test-pod"], { token: testToken });

      // Try to create duplicate
      const result = await cli.exec(["pod", "create", "test-pod"], {
        token: testToken,
      });

      expect(result.exitCode).to.not.equal(0);
      expect(result.stderr).to.include("POD_EXISTS");
    });

    it("should require authentication", async () => {
      const result = await cli.exec(["pod", "create", "test-pod"]);

      expect(result.exitCode).to.not.equal(0);
      expect(result.stderr).to.include("Authentication required");
    });
  });

  describe("list command", () => {
    beforeEach(async () => {
      // Create test pods with owner_id set
      for (const podName of ["pod-1", "pod-2", "pod-3"]) {
        // Create pod with owner_id
        const now = Date.now();
        await executeInsert(
          testDb.getDb(),
          schema,
          (q, p) =>
            q.insertInto("pod").values({
              name: p.name,
              owner_id: p.owner_id,
              created_at: p.now,
              updated_at: p.now,
              metadata: "{}",
            }),
          {
            name: podName,
            owner_id: testUser.userId,
            now,
          },
        );

        // Create .config/owner stream using the new helper
        await createOwnerConfig(
          testDb.getDb(),
          podName,
          testUser.userId,
          testUser.userId,
        );
      }
    });

    it("should list all user pods", async () => {
      const result = await cli.exec(["pod", "list", "--format", "json"], {
        token: testToken,
      });

      expect(result.exitCode).to.equal(0);
      const pods = cli.parseJson(result.stdout);
      expect(pods).to.be.an("array");
      expect(pods).to.have.length(3);
      expect(pods[0].name).to.be.oneOf(["pod-1", "pod-2", "pod-3"]);
    });

    it("should show message when no pods exist", async () => {
      await resetCliTestDb();

      const result = await cli.exec(["pod", "list"], {
        token: testToken,
      });

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include("No pods found");
      expect(result.stdout).to.include("Create one with");
    });

    it("should support different output formats", async () => {
      // CSV format
      const csvResult = await cli.exec(["pod", "list", "--format", "csv"], {
        token: testToken,
      });
      expect(csvResult.exitCode).to.equal(0);
      expect(csvResult.stdout).to.include("name,id,created_at");

      // YAML format
      const yamlResult = await cli.exec(["pod", "list", "--format", "yaml"], {
        token: testToken,
      });
      expect(yamlResult.exitCode).to.equal(0);
      expect(yamlResult.stdout).to.include("name: pod-");
    });
  });

  describe("info command", () => {
    beforeEach(async () => {
      // Create test pod with owner stream
      const now = Date.now();
      await executeInsert(
        testDb.getDb(),
        schema,
        (q, p) =>
          q.insertInto("pod").values({
            name: p.name,
            created_at: p.now,
            updated_at: p.now,
            metadata: "{}",
          }),
        {
          name: "test-pod",
          now,
        },
      );

      // Create .config/owner stream using the new helper
      await createOwnerConfig(
        testDb.getDb(),
        "test-pod",
        testUser.userId,
        testUser.userId,
      );
    });

    it("should show pod details", async () => {
      // Create a test stream so the pod has some data
      await createStreamWithRecord(
        testDb.getDb(),
        "test-pod",
        "test-stream",
        undefined,
        JSON.stringify({ test: "data" }),
        testUser.userId,
      );

      const result = await cli.exec(
        ["pod", "info", "test-pod", "--format", "json"],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);
      const info = cli.parseJson(result.stdout);
      // The info command returns streams data, not pod metadata
      expect(info.pod).to.equal("test-pod");
      expect(info.streams).to.be.an("array");
      expect(info.streams).to.have.length(3); // .config, .config/owner, and test-stream
    });

    it("should fail for non-existent pod", async () => {
      const result = await cli.exec(["pod", "info", "no-such-pod"], {
        token: testToken,
      });

      expect(result.exitCode).to.not.equal(0);
      expect(result.stderr).to.include("not found");
    });
  });

  describe("delete command", () => {
    beforeEach(async () => {
      // Create test pod with owner stream
      const now = Date.now();
      await executeInsert(
        testDb.getDb(),
        schema,
        (q, p) =>
          q.insertInto("pod").values({
            name: p.name,
            created_at: p.now,
            updated_at: p.now,
            metadata: "{}",
          }),
        {
          name: "test-pod",
          now,
        },
      );

      // Create .config/owner stream using the new helper
      await createOwnerConfig(
        testDb.getDb(),
        "test-pod",
        testUser.userId,
        testUser.userId,
      );
    });

    it("should delete a pod with force flag", async () => {
      const result = await cli.exec(["pod", "delete", "test-pod", "--force"], {
        token: testToken,
      });

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include("Pod 'test-pod' deleted successfully");

      // Verify pod was deleted
      const podResults = await executeSelect(
        testDb.getDb(),
        schema,
        (q, p) =>
          q
            .from("pod")
            .where((pod) => pod.name === p.name)
            .take(1),
        {
          name: "test-pod",
        },
      );
      const pod = podResults[0] || null;
      expect(pod).to.be.null;
    });

    it("should show warning without force flag", async () => {
      const result = await cli.exec(["pod", "delete", "test-pod"], {
        token: testToken,
      });

      expect(result.stdout).to.include("WARNING");
      expect(result.stdout).to.include("permanently delete");
      expect(result.stdout).to.include("--force");

      // Verify pod was NOT deleted
      const podResults = await executeSelect(
        testDb.getDb(),
        schema,
        (q, p) =>
          q
            .from("pod")
            .where((pod) => pod.name === p.name)
            .take(1),
        {
          name: "test-pod",
        },
      );
      const pod = podResults[0] || null;
      expect(pod).to.not.be.null;
    });

    it("should only allow owner to delete pod", async () => {
      // Create another user with identity
      const otherUserId = randomUUID();
      const now = Date.now();
      await executeInsert(
        testDb.getDb(),
        schema,
        (q, p) =>
          q.insertInto("user").values({
            id: p.id,
            created_at: p.now,
            updated_at: p.now,
          }),
        { id: otherUserId, now },
      );
      const identityId = randomUUID();
      const providerId = randomUUID();
      await executeInsert(
        testDb.getDb(),
        schema,
        (q, p) =>
          q.insertInto("identity").values({
            id: p.id,
            user_id: p.userId,
            provider: p.provider,
            provider_id: p.providerId,
            email: p.email,
            name: p.name,
            metadata: p.metadata,
            created_at: p.now,
            updated_at: p.now,
          }),
        {
          id: identityId,
          userId: otherUserId,
          provider: "test-provider",
          providerId,
          now,
          email: "other@example.com",
          name: "Other User",
          metadata: "{}",
        },
      );
      const otherToken = cli.createTestToken(otherUserId, "other@example.com");

      const result = await cli.exec(["pod", "delete", "test-pod", "--force"], {
        token: otherToken,
      });

      // Error message varies - could be "Invalid token" or "Unauthorized"
      expect(result.exitCode).to.not.equal(0);
    });
  });
});
