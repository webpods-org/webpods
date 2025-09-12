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
} from "../test-setup.js";
import { createOwnerConfig } from "../utils/test-data-helpers.js";

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
    await createOwnerConfig(
      testDb.getDb(),
      testPodName,
      testUser.userId,
      testUser.userId,
    );
  });

  describe("links set command", () => {
    it("should set a link for a pod", async () => {
      const result = await cli.exec(
        ["link", "set", testPodName, "/about", "pages/about"],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include("Link set: /about → pages/about");
    });

    it("should set multiple links", async () => {
      const result1 = await cli.exec(
        ["link", "set", testPodName, "/", "homepage/index"],
        {
          token: testToken,
        },
      );
      expect(result1.exitCode).to.equal(0);

      const result2 = await cli.exec(
        ["link", "set", testPodName, "/blog", "blog/posts?unique=true"],
        {
          token: testToken,
        },
      );
      expect(result2.exitCode).to.equal(0);
    });

    it("should require authentication", async () => {
      const result = await cli.exec([
        "link",
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
      await cli.exec(["link", "set", testPodName, "/", "homepage/index"], {
        token: testToken,
      });
      await cli.exec(["link", "set", testPodName, "/about", "pages/about"], {
        token: testToken,
      });
      await cli.exec(["link", "set", testPodName, "/blog", "blog/posts"], {
        token: testToken,
      });
    });

    it("should list all links for a pod", async () => {
      const result = await cli.exec(["link", "list", testPodName], {
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
        ["link", "list", testPodName, "--format", "json"],
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

      const result = await cli.exec(["link", "list", emptyPodName], {
        token: testToken,
      });

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include("No links configured");
    });
  });

  describe("links remove command", () => {
    beforeEach(async () => {
      // Set up test links
      await cli.exec(["link", "set", testPodName, "/about", "pages/about"], {
        token: testToken,
      });
      await cli.exec(["link", "set", testPodName, "/blog", "blog/posts"], {
        token: testToken,
      });
    });

    it("should remove a specific link", async () => {
      const result = await cli.exec(["link", "remove", testPodName, "/about"], {
        token: testToken,
      });

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include("Link removed: /about");

      // Verify link was removed
      const listResult = await cli.exec(["link", "list", testPodName], {
        token: testToken,
      });
      expect(listResult.stdout).to.not.include("/about → pages/about");
      expect(listResult.stdout).to.include("/blog → blog/posts"); // Other links remain
    });

    it("should handle removing non-existent link", async () => {
      const result = await cli.exec(
        ["link", "remove", testPodName, "/nonexistent"],
        {
          token: testToken,
        },
      );

      // May succeed or fail depending on implementation
      // Just verify it doesn't crash
      expect(result.exitCode).to.be.oneOf([0, 1]);
    });

    it("should require authentication", async () => {
      const result = await cli.exec(["link", "remove", testPodName, "/about"]);

      expect(result.exitCode).to.not.equal(0);
      expect(result.stderr).to.include("Not authenticated");
    });
  });
});
