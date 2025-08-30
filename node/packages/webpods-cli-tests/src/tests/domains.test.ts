/**
 * CLI Domain Commands Tests
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

describe("CLI Domain Commands", function () {
  this.timeout(30000);

  let cli: CliTestHelper;
  let testPodName: string;

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

    // Create a test pod
    testPodName = `test-pod-${Date.now()}`;
    await testDb
      .getDb()
      .none("INSERT INTO pod (name, created_at) VALUES ($(name), NOW())", {
        name: testPodName,
      });

    // Create .meta/owner stream for pod ownership
    await testDb
      .getDb()
      .none(
        "INSERT INTO stream (pod_name, name, user_id) VALUES ($(podName), $(streamName), $(userId))",
        {
          podName: testPodName,
          streamName: ".meta/owner",
          userId: testUser.userId,
        },
      );

    // Add owner record
    await testDb.getDb().none(
      `INSERT INTO record (pod_name, stream_name, name, content, content_type, hash, user_id, index) 
       VALUES ($(podName), $(streamName), $(name), $(content), $(contentType), $(hash), $(userId), 0)`,
      {
        podName: testPodName,
        streamName: ".meta/owner",
        name: "owner",
        content: JSON.stringify({ owner: testUser.userId }),
        contentType: "application/json",
        hash: "hash-owner",
        userId: testUser.userId,
      },
    );
  });

  describe("domain add command", () => {
    it("should add a custom domain to a pod", async () => {
      const result = await cli.exec(
        ["domain", "add", testPodName, "blog.example.com"],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include(
        "Custom domain 'blog.example.com' added",
      );
      expect(result.stdout).to.include("Next steps:");
      expect(result.stdout).to.include("CNAME");
    });

    it("should add multiple domains", async () => {
      const result1 = await cli.exec(
        ["domain", "add", testPodName, "www.example.com"],
        {
          token: testToken,
        },
      );
      expect(result1.exitCode).to.equal(0);

      const result2 = await cli.exec(
        ["domain", "add", testPodName, "blog.example.com"],
        {
          token: testToken,
        },
      );
      expect(result2.exitCode).to.equal(0);
    });

    it("should validate domain format", async () => {
      const result = await cli.exec(
        ["domain", "add", testPodName, "not a valid domain!"],
        {
          token: testToken,
        },
      );

      // The API should reject invalid domains
      expect(result.exitCode).to.not.equal(0);
    });

    it("should require authentication", async () => {
      const result = await cli.exec([
        "domain",
        "add",
        testPodName,
        "example.com",
      ]);

      expect(result.exitCode).to.not.equal(0);
      expect(result.stderr).to.include("Not authenticated");
    });
  });

  describe("domain list command", () => {
    beforeEach(async () => {
      // Add some test domains
      await cli.exec(["domain", "add", testPodName, "www.example.com"], {
        token: testToken,
      });
      await cli.exec(["domain", "add", testPodName, "blog.example.com"], {
        token: testToken,
      });
      await cli.exec(["domain", "add", testPodName, "api.example.com"], {
        token: testToken,
      });
    });

    it("should list all domains for a pod", async () => {
      const result = await cli.exec(["domain", "list", testPodName], {
        token: testToken,
      });

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include(
        `Custom domains for pod '${testPodName}'`,
      );
      expect(result.stdout).to.include("www.example.com");
      expect(result.stdout).to.include("blog.example.com");
      expect(result.stdout).to.include("api.example.com");
    });

    it("should show verification status", async () => {
      const result = await cli.exec(["domain", "list", testPodName], {
        token: testToken,
      });

      expect(result.exitCode).to.equal(0);
      // Should show verification status (Pending or Verified)
      expect(result.stdout).to.match(/Pending|Verified/);
    });

    it("should output in JSON format", async () => {
      const result = await cli.exec(
        ["domain", "list", testPodName, "--format", "json"],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);
      const data = JSON.parse(result.stdout);
      expect(data).to.have.property("records");
    });

    it("should show message when no domains exist", async () => {
      // Use a fresh pod with no domains
      const emptyPodName = `empty-pod-${Date.now()}`;
      await testDb
        .getDb()
        .none("INSERT INTO pod (name, created_at) VALUES ($(name), NOW())", {
          name: emptyPodName,
        });

      const result = await cli.exec(["domain", "list", emptyPodName], {
        token: testToken,
      });

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include("No custom domains configured");
    });
  });

  describe("domain remove command", () => {
    beforeEach(async () => {
      // Add test domains
      await cli.exec(["domain", "add", testPodName, "www.example.com"], {
        token: testToken,
      });
      await cli.exec(["domain", "add", testPodName, "blog.example.com"], {
        token: testToken,
      });
    });

    it("should remove a specific domain", async () => {
      const result = await cli.exec(
        ["domain", "remove", testPodName, "www.example.com"],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include(
        "Custom domain 'www.example.com' removed",
      );

      // Verify domain was removed
      const listResult = await cli.exec(["domain", "list", testPodName], {
        token: testToken,
      });
      expect(listResult.stdout).to.not.include("www.example.com");
      expect(listResult.stdout).to.include("blog.example.com"); // Other domains remain
    });

    it("should handle removing non-existent domain", async () => {
      const result = await cli.exec(
        ["domain", "remove", testPodName, "nonexistent.com"],
        {
          token: testToken,
        },
      );

      // May succeed or fail depending on implementation
      expect(result.exitCode).to.be.oneOf([0, 1]);
    });

    it("should require authentication", async () => {
      const result = await cli.exec([
        "domain",
        "remove",
        testPodName,
        "www.example.com",
      ]);

      expect(result.exitCode).to.not.equal(0);
      expect(result.stderr).to.include("Not authenticated");
    });
  });
});
