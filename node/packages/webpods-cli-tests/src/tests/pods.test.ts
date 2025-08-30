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
      const result = await cli.exec(["create", "test-pod"], {
        token: testToken,
      });

      if (result.exitCode !== 0) {
        console.log("Pod creation failed - Exit code:", result.exitCode);
        console.log("Stdout:", result.stdout);
        console.log("Stderr:", result.stderr);
      }

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include("Pod 'test-pod' created successfully");

      // Verify pod was created in database
      const pod = await testDb
        .getDb()
        .oneOrNone("SELECT * FROM pod WHERE name = $(name)", {
          name: "test-pod",
        });
      expect(pod).to.not.be.null;

      // Verify ownership via .meta/owner stream
      const ownerRecord = await testDb.getDb().oneOrNone(
        `SELECT * FROM record 
           WHERE pod_name = $(podName) 
           AND stream_name = '.meta/owner' 
           AND name = 'owner'`,
        { podName: "test-pod" },
      );
      expect(ownerRecord).to.not.be.null;
      const ownerContent = JSON.parse(ownerRecord.content);
      expect(ownerContent.owner).to.equal(testUser.userId);
    });

    it("should reject invalid pod names", async () => {
      const result = await cli.exec(["create", "Test-Pod"], {
        token: testToken,
      });

      expect(result.exitCode).to.not.equal(0);
      expect(result.stderr).to.include("Invalid pod name");
    });

    it("should reject duplicate pod names", async () => {
      // Create first pod
      await cli.exec(["create", "test-pod"], { token: testToken });

      // Try to create duplicate
      const result = await cli.exec(["create", "test-pod"], {
        token: testToken,
      });

      expect(result.exitCode).to.not.equal(0);
      expect(result.stderr).to.include("POD_EXISTS");
    });

    it("should require authentication", async () => {
      const result = await cli.exec(["create", "test-pod"]);

      expect(result.exitCode).to.not.equal(0);
      expect(result.stderr).to.include("Authentication required");
    });
  });

  describe("list command", () => {
    beforeEach(async () => {
      // Create test pods with owner stream
      for (const podName of ["pod-1", "pod-2", "pod-3"]) {
        // Create pod
        await testDb
          .getDb()
          .none("INSERT INTO pod (name, created_at) VALUES ($(name), NOW())", {
            name: podName,
          });

        // Create .meta/owner stream
        await testDb
          .getDb()
          .none(
            "INSERT INTO stream (pod_name, name, user_id) VALUES ($(podName), $(streamName), $(userId))",
            { podName, streamName: ".meta/owner", userId: testUser.userId },
          );

        // Add owner record
        await testDb.getDb().none(
          `INSERT INTO record (pod_name, stream_name, name, content, content_type, hash, user_id, index) 
           VALUES ($(podName), $(streamName), $(name), $(content), $(contentType), $(hash), $(userId), 0)`,
          {
            podName,
            streamName: ".meta/owner",
            name: "owner",
            content: JSON.stringify({ owner: testUser.userId }),
            contentType: "application/json",
            hash: "hash-" + podName,
            userId: testUser.userId,
          },
        );
      }
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
      // Create test pod with owner stream
      await testDb
        .getDb()
        .none("INSERT INTO pod (name, created_at) VALUES ($(name), NOW())", {
          name: "test-pod",
        });

      // Create .meta/owner stream
      await testDb
        .getDb()
        .none(
          "INSERT INTO stream (pod_name, name, user_id) VALUES ($(podName), $(streamName), $(userId))",
          {
            podName: "test-pod",
            streamName: ".meta/owner",
            userId: testUser.userId,
          },
        );

      // Add owner record
      await testDb.getDb().none(
        `INSERT INTO record (pod_name, stream_name, name, content, content_type, hash, user_id, index) 
         VALUES ($(podName), $(streamName), $(name), $(content), $(contentType), $(hash), $(userId), 0)`,
        {
          podName: "test-pod",
          streamName: ".meta/owner",
          name: "owner",
          content: JSON.stringify({ owner: testUser.userId }),
          contentType: "application/json",
          hash: "hash-test-pod",
          userId: testUser.userId,
        },
      );
    });

    it("should show pod details", async () => {
      // Create a test stream so the pod has some data
      await testDb
        .getDb()
        .none(
          "INSERT INTO stream (pod_name, name, user_id) VALUES ($(podName), $(streamName), $(userId))",
          {
            podName: "test-pod",
            streamName: "test-stream",
            userId: testUser.userId,
          },
        );

      const result = await cli.exec(["info", "test-pod", "--format", "json"], {
        token: testToken,
      });

      expect(result.exitCode).to.equal(0);
      const info = cli.parseJson(result.stdout);
      // The info command returns streams data, not pod metadata
      expect(info.pod).to.equal("test-pod");
      expect(info.streams).to.be.an("array");
      expect(info.streams).to.have.length(2); // .meta/owner and test-stream
    });

    it("should fail for non-existent pod", async () => {
      const result = await cli.exec(["info", "no-such-pod"], {
        token: testToken,
      });

      expect(result.exitCode).to.not.equal(0);
      expect(result.stderr).to.include("not found");
    });
  });

  describe("delete command", () => {
    beforeEach(async () => {
      // Create test pod with owner stream
      await testDb
        .getDb()
        .none("INSERT INTO pod (name, created_at) VALUES ($(name), NOW())", {
          name: "test-pod",
        });

      // Create .meta/owner stream
      await testDb
        .getDb()
        .none(
          "INSERT INTO stream (pod_name, name, user_id) VALUES ($(podName), $(streamName), $(userId))",
          {
            podName: "test-pod",
            streamName: ".meta/owner",
            userId: testUser.userId,
          },
        );

      // Add owner record
      await testDb.getDb().none(
        `INSERT INTO record (pod_name, stream_name, name, content, content_type, hash, user_id, index) 
         VALUES ($(podName), $(streamName), $(name), $(content), $(contentType), $(hash), $(userId), 0)`,
        {
          podName: "test-pod",
          streamName: ".meta/owner",
          name: "owner",
          content: JSON.stringify({ owner: testUser.userId }),
          contentType: "application/json",
          hash: "hash-test-pod",
          userId: testUser.userId,
        },
      );
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
        .oneOrNone("SELECT * FROM pod WHERE name = $(name)", {
          name: "test-pod",
        });
      expect(pod).to.be.null;
    });

    it("should show warning without force flag", async () => {
      const result = await cli.exec(["delete", "test-pod"], {
        token: testToken,
      });

      expect(result.stdout).to.include("WARNING");
      expect(result.stdout).to.include("permanently delete");
      expect(result.stdout).to.include("--force");

      // Verify pod was NOT deleted
      const pod = await testDb
        .getDb()
        .oneOrNone("SELECT * FROM pod WHERE name = $(name)", {
          name: "test-pod",
        });
      expect(pod).to.not.be.null;
    });

    it("should only allow owner to delete pod", async () => {
      // Create another user with identity
      const otherUserId = randomUUID();
      await testDb
        .getDb()
        .none(
          'INSERT INTO "user" (id, created_at, updated_at) VALUES ($(id), NOW(), NOW())',
          { id: otherUserId },
        );
      await testDb
        .getDb()
        .none(
          "INSERT INTO identity (id, user_id, provider, provider_id, email, name, created_at, updated_at) VALUES ($(id), $(userId), $(provider), $(providerId), $(email), $(name), NOW(), NOW())",
          {
            id: randomUUID(),
            userId: otherUserId,
            provider: "test-provider",
            providerId: randomUUID(),
            email: "other@example.com",
            name: "Other User",
          },
        );
      const otherToken = cli.createTestToken(otherUserId, "other@example.com");

      const result = await cli.exec(["delete", "test-pod", "--force"], {
        token: otherToken,
      });

      // Error message varies - could be "Invalid token" or "Unauthorized"
      expect(result.exitCode).to.not.equal(0);
    });
  });
});
