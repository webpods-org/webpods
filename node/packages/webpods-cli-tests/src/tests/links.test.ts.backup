/**
 * CLI Links Commands Tests
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
  calculateContentHash,
  calculateRecordHash,
} from "../test-setup.js";

describe("CLI Links Commands", function () {
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

    // Create .config/owner stream for pod ownership
    await testDb
      .getDb()
      .none(
        "INSERT INTO stream (pod_name, name, user_id) VALUES ($(podName), $(streamName), $(userId))",
        {
          podName: testPodName,
          streamName: "/.config/owner",
          userId: testUser.userId,
        },
      );

    // Add owner record
    const content = JSON.stringify({ owner: testUser.userId });
    const contentHash = calculateContentHash(content);
    const timestamp = new Date().toISOString();
    const hash = calculateRecordHash(
      null,
      contentHash,
      testUser.userId,
      timestamp,
    );

    await testDb.getDb().none(
      `INSERT INTO record (pod_name, stream_name, name, content, content_type, content_hash, hash, user_id, index, created_at) 
       VALUES ($(podName), $(streamName), $(name), $(content), $(contentType), $(contentHash), $(hash), $(userId), 0, $(timestamp))`,
      {
        podName: testPodName,
        streamName: "/.config/owner",
        name: "owner",
        content,
        contentType: "application/json",
        contentHash,
        hash,
        userId: testUser.userId,
        timestamp,
      },
    );
  });

  describe("links set command", () => {
    it("should set a link for a pod", async () => {
      const result = await cli.exec(
        ["links", "set", testPodName, "/about", "pages/about"],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include("Link set: /about → pages/about");
    });

    it("should set multiple links", async () => {
      const result1 = await cli.exec(
        ["links", "set", testPodName, "/", "homepage/index"],
        {
          token: testToken,
        },
      );
      expect(result1.exitCode).to.equal(0);

      const result2 = await cli.exec(
        ["links", "set", testPodName, "/blog", "blog/posts?unique=true"],
        {
          token: testToken,
        },
      );
      expect(result2.exitCode).to.equal(0);
    });

    it("should require authentication", async () => {
      const result = await cli.exec([
        "links",
        "set",
        testPodName,
        "/about",
        "pages/about",
      ]);

      expect(result.exitCode).to.not.equal(0);
      expect(result.stderr).to.include("Not authenticated");
    });
  });

  describe("links list command", () => {
    beforeEach(async () => {
      // Set up some test links
      await cli.exec(["links", "set", testPodName, "/", "homepage/index"], {
        token: testToken,
      });
      await cli.exec(["links", "set", testPodName, "/about", "pages/about"], {
        token: testToken,
      });
      await cli.exec(["links", "set", testPodName, "/blog", "blog/posts"], {
        token: testToken,
      });
    });

    it("should list all links for a pod", async () => {
      const result = await cli.exec(["links", "list", testPodName], {
        token: testToken,
      });

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include(`Links for pod '${testPodName}'`);
      expect(result.stdout).to.include("/ → homepage/index");
      expect(result.stdout).to.include("/about → pages/about");
      expect(result.stdout).to.include("/blog → blog/posts");
    });

    it("should output in JSON format", async () => {
      const result = await cli.exec(
        ["links", "list", testPodName, "--format", "json"],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);
      const data = JSON.parse(result.stdout);
      expect(data).to.have.property("records");
    });

    it("should show message when no links exist", async () => {
      // Use a fresh pod with no links
      const emptyPodName = `empty-pod-${Date.now()}`;
      await testDb
        .getDb()
        .none("INSERT INTO pod (name, created_at) VALUES ($(name), NOW())", {
          name: emptyPodName,
        });

      const result = await cli.exec(["links", "list", emptyPodName], {
        token: testToken,
      });

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include("No links configured");
    });
  });

  describe("links remove command", () => {
    beforeEach(async () => {
      // Set up test links
      await cli.exec(["links", "set", testPodName, "/about", "pages/about"], {
        token: testToken,
      });
      await cli.exec(["links", "set", testPodName, "/blog", "blog/posts"], {
        token: testToken,
      });
    });

    it("should remove a specific link", async () => {
      const result = await cli.exec(
        ["links", "remove", testPodName, "/about"],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include("Link removed: /about");

      // Verify link was removed
      const listResult = await cli.exec(["links", "list", testPodName], {
        token: testToken,
      });
      expect(listResult.stdout).to.not.include("/about → pages/about");
      expect(listResult.stdout).to.include("/blog → blog/posts"); // Other links remain
    });

    it("should handle removing non-existent link", async () => {
      const result = await cli.exec(
        ["links", "remove", testPodName, "/nonexistent"],
        {
          token: testToken,
        },
      );

      // May succeed or fail depending on implementation
      // Just verify it doesn't crash
      expect(result.exitCode).to.be.oneOf([0, 1]);
    });

    it("should require authentication", async () => {
      const result = await cli.exec(["links", "remove", testPodName, "/about"]);

      expect(result.exitCode).to.not.equal(0);
      expect(result.stderr).to.include("Not authenticated");
    });
  });
});
