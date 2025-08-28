/**
 * CLI Pod Management Commands Tests
 */

import { expect } from "chai";
import { CliTestHelper } from "../cli-test-helpers.js";
import {
  setupCliTests,
  cleanupCliTests,
  resetCliTestDb,
  testToken,
  testUser,
  testDb,
} from "../test-setup.js";

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
      const result = await cli.exec(["create", "test-pod"], {
        token: testToken,
      });

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include("Pod 'test-pod' created successfully");
      expect(result.stdout).to.include(
        "Access it at: https://test-pod.webpods.org",
      );

      // Verify pod was created in database
      const pod = await testDb
        .getDb()
        .oneOrNone("SELECT * FROM pod WHERE name = $1", ["test-pod"]);
      expect(pod).to.not.be.null;
      expect(pod.user_id).to.equal(testUser.id);
    });

    it("should reject invalid pod names", async () => {
      const result = await cli.exec(["create", "Test-Pod"], {
        token: testToken,
      });

      expect(result.exitCode).to.not.equal(0);
      expect(result.stdout).to.include("Invalid pod name");
    });

    it("should reject duplicate pod names", async () => {
      // Create first pod
      await cli.exec(["create", "test-pod"], { token: testToken });

      // Try to create duplicate
      const result = await cli.exec(["create", "test-pod"], {
        token: testToken,
      });

      expect(result.exitCode).to.not.equal(0);
      expect(result.stdout).to.include("already exists");
    });

    it("should require authentication", async () => {
      const result = await cli.exec(["create", "test-pod"]);

      expect(result.exitCode).to.not.equal(0);
      expect(result.stdout).to.include("Not authenticated");
    });
  });

  describe("list command", () => {
    beforeEach(async () => {
      // Create some test pods
      await testDb
        .getDb()
        .none(
          "INSERT INTO pod (name, user_id) VALUES ($1, $2), ($3, $2), ($4, $2)",
          ["pod-1", testUser.id, "pod-2", "pod-3"],
        );
    });

    it("should list all user pods", async () => {
      const result = await cli.exec(["list", "--format", "json"], {
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

      const result = await cli.exec(["list"], {
        token: testToken,
      });

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include("No pods found");
      expect(result.stdout).to.include("Create one with");
    });

    it("should support different output formats", async () => {
      // CSV format
      const csvResult = await cli.exec(["list", "--format", "csv"], {
        token: testToken,
      });
      expect(csvResult.exitCode).to.equal(0);
      expect(csvResult.stdout).to.include("name,id,created_at");

      // YAML format
      const yamlResult = await cli.exec(["list", "--format", "yaml"], {
        token: testToken,
      });
      expect(yamlResult.exitCode).to.equal(0);
      expect(yamlResult.stdout).to.include("name: pod-");
    });
  });

  describe("info command", () => {
    beforeEach(async () => {
      await testDb
        .getDb()
        .none("INSERT INTO pod (name, user_id) VALUES ($1, $2)", [
          "test-pod",
          testUser.id,
        ]);
    });

    it("should show pod details", async () => {
      const result = await cli.exec(["info", "test-pod", "--format", "json"], {
        token: testToken,
      });

      expect(result.exitCode).to.equal(0);
      const info = cli.parseJson(result.stdout);
      expect(info.name).to.equal("test-pod");
      expect(info.user_id).to.equal(testUser.id);
    });

    it("should fail for non-existent pod", async () => {
      const result = await cli.exec(["info", "no-such-pod"], {
        token: testToken,
      });

      expect(result.exitCode).to.not.equal(0);
      expect(result.stdout).to.include("Pod not found");
    });
  });

  describe("delete command", () => {
    beforeEach(async () => {
      await testDb
        .getDb()
        .none("INSERT INTO pod (name, user_id) VALUES ($1, $2)", [
          "test-pod",
          testUser.id,
        ]);
    });

    it("should delete a pod with force flag", async () => {
      const result = await cli.exec(["delete", "test-pod", "--force"], {
        token: testToken,
      });

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include("Pod 'test-pod' deleted successfully");

      // Verify pod was deleted
      const pod = await testDb
        .getDb()
        .oneOrNone("SELECT * FROM pod WHERE name = $1", ["test-pod"]);
      expect(pod).to.be.null;
    });

    it("should prompt for confirmation without force flag", async () => {
      const result = await cli.exec(["delete", "test-pod"], {
        token: testToken,
        input: "n\n", // Respond 'n' to confirmation
      });

      expect(result.stdout).to.include("Are you sure");
      expect(result.stdout).to.include("Cancelled");

      // Verify pod was NOT deleted
      const pod = await testDb
        .getDb()
        .oneOrNone("SELECT * FROM pod WHERE name = $1", ["test-pod"]);
      expect(pod).to.not.be.null;
    });

    it("should only allow owner to delete pod", async () => {
      // Create another user
      const otherUser = await testDb
        .getDb()
        .one(
          'INSERT INTO "user" (email, name, provider) VALUES ($1, $2, $3) RETURNING *',
          ["other@example.com", "Other User", "test-provider"],
        );
      const otherToken = cli.createTestToken(otherUser.id, otherUser.email);

      const result = await cli.exec(["delete", "test-pod", "--force"], {
        token: otherToken,
      });

      expect(result.exitCode).to.not.equal(0);
      expect(result.stdout).to.include("not authorized");
    });
  });
});
