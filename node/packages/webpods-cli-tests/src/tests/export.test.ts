/**
 * CLI Export Command Tests
 */

import { expect } from "chai";
import fs from "fs/promises";
import { CliTestHelper } from "../cli-test-helpers.js";
import {
  setupCliTests,
  cleanupCliTests,
  resetCliTestDb,
  testToken,
  testUser,
  testDb,
} from "../test-setup.js";

describe("CLI Export Command", function () {
  this.timeout(30000);

  let cli: CliTestHelper;
  let testPodName: string;
  let exportPath: string;

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

    // Create a test pod with data
    testPodName = `test-pod-${Date.now()}`;
    exportPath = `/tmp/test-export-${Date.now()}.json`;

    await testDb
      .getDb()
      .none("INSERT INTO pod (name, created_at) VALUES ($(name), NOW())", {
        name: testPodName,
      });

    // Create multiple streams with records
    const streams = [
      { name: "blog/posts", permission: "public" },
      { name: "private/notes", permission: "private" },
      { name: "data/users", permission: "private" },
    ];

    for (const stream of streams) {
      await testDb
        .getDb()
        .none(
          "INSERT INTO stream (pod_name, name, user_id, access_permission) VALUES ($(podName), $(name), $(userId), $(permission))",
          {
            podName: testPodName,
            name: stream.name,
            userId: testUser.userId,
            permission: stream.permission,
          },
        );

      // Add some records to each stream
      for (let i = 0; i < 3; i++) {
        await testDb.getDb().none(
          `INSERT INTO record (pod_name, stream_name, name, content, content_type, hash, user_id, index) 
           VALUES ($(podName), $(streamName), $(name), $(content), $(contentType), $(hash), $(userId), $(index))`,
          {
            podName: testPodName,
            streamName: stream.name,
            name: `record-${i}`,
            content: JSON.stringify({
              stream: stream.name,
              index: i,
              data: `Content for ${stream.name} record ${i}`,
            }),
            contentType: "application/json",
            hash: `sha256:hash-${stream.name}-${i}`,
            userId: testUser.userId,
            index: i,
          },
        );
      }
    }
  });

  afterEach(async () => {
    // Clean up export files
    try {
      await fs.unlink(exportPath);
    } catch {
      // File might not exist
    }
  });

  describe("export command", () => {
    it("should export pod data to JSON file", async () => {
      const result = await cli.exec(
        ["export", testPodName, "--output", exportPath],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include("✓ Pod exported successfully");
      expect(result.stdout).to.include(exportPath);
      expect(result.stdout).to.include("Streams:");
      expect(result.stdout).to.include("Records:");

      // Verify file was created
      const fileExists = await fs
        .access(exportPath)
        .then(() => true)
        .catch(() => false);
      expect(fileExists).to.be.true;

      // Verify file content
      const exportData = JSON.parse(await fs.readFile(exportPath, "utf-8"));
      expect(exportData).to.have.property("pod", testPodName);
      expect(exportData).to.have.property("exported_at");
      expect(exportData).to.have.property("version", "1.0");
      expect(exportData).to.have.property("streams");
      expect(Object.keys(exportData.streams)).to.have.length.at.least(3);
    });

    it("should use default filename if output not specified", async () => {
      const result = await cli.exec(["export", testPodName], {
        token: testToken,
      });

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include("✓ Pod exported successfully");
      expect(result.stdout).to.match(
        new RegExp(`${testPodName}-backup-\\d+\\.json`),
      );

      // Extract filename from output and clean it up
      const match = result.stdout.match(
        new RegExp(`(${testPodName}-backup-\\d+\\.json)`),
      );
      if (match && match[1]) {
        try {
          await fs.unlink(match[1]);
        } catch {
          // Ignore cleanup errors
        }
      }
    });

    it("should exclude metadata streams when flag is set", async () => {
      const result = await cli.exec(
        ["export", testPodName, "--output", exportPath, "--no-metadata"],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);

      const exportData = JSON.parse(await fs.readFile(exportPath, "utf-8"));
      const streamNames = Object.keys(exportData.streams);

      // Should not include .config/* streams
      const hasMetaStreams = streamNames.some((name) =>
        name.startsWith(".config/"),
      );
      expect(hasMetaStreams).to.be.false;
    });

    it("should require authentication", async () => {
      const result = await cli.exec([
        "export",
        testPodName,
        "--output",
        exportPath,
      ]);

      expect(result.exitCode).to.not.equal(0);
      expect(result.stderr).to.include("Not authenticated");
    });

    it("should handle non-existent pod", async () => {
      const result = await cli.exec(
        ["export", "non-existent-pod", "--output", exportPath],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.not.equal(0);
    });
  });
});
