/**
 * CLI Export/Import Commands Tests
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

describe("CLI Export/Import Commands", function () {
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
              data: `Content for ${stream.name} record ${i}` 
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
      const fileExists = await fs.access(exportPath).then(() => true).catch(() => false);
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
      const result = await cli.exec(
        ["export", testPodName],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include("✓ Pod exported successfully");
      expect(result.stdout).to.match(new RegExp(`${testPodName}-backup-\\d+\\.json`));
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
      
      // Should not include .meta/* streams
      const hasMetaStreams = streamNames.some(name => name.startsWith(".meta/"));
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

  describe("import command", () => {
    let importPodName: string;

    beforeEach(async () => {
      // First export the test pod
      await cli.exec(
        ["export", testPodName, "--output", exportPath],
        { token: testToken },
      );

      // Create a new pod for import
      importPodName = `import-pod-${Date.now()}`;
      await testDb
        .getDb()
        .none("INSERT INTO pod (name, created_at) VALUES ($(name), NOW())", {
          name: importPodName,
        });
    });

    it("should import pod data from JSON file", async () => {
      const result = await cli.exec(
        ["import", importPodName, "--file", exportPath],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include("✓ Import completed successfully");
      expect(result.stdout).to.include("Imported streams:");
      expect(result.stdout).to.include("Imported records:");

      // Verify data was imported
      const streams = await testDb
        .getDb()
        .any("SELECT * FROM stream WHERE pod_name = $(podName)", {
          podName: importPodName,
        });
      expect(streams).to.have.length.at.least(3);

      const records = await testDb
        .getDb()
        .any("SELECT * FROM record WHERE pod_name = $(podName)", {
          podName: importPodName,
        });
      expect(records).to.have.length.at.least(9); // 3 streams × 3 records
    });

    it("should perform dry run without making changes", async () => {
      const result = await cli.exec(
        ["import", importPodName, "--file", exportPath, "--dry-run"],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include("Dry run - no data will be imported");
      expect(result.stdout).to.include("blog/posts:");
      expect(result.stdout).to.include("private/notes:");
      expect(result.stdout).to.include("data/users:");

      // Verify no data was actually imported
      const streams = await testDb
        .getDb()
        .any("SELECT * FROM stream WHERE pod_name = $(podName)", {
          podName: importPodName,
        });
      expect(streams).to.have.length(0);
    });

    it("should prevent overwriting existing data without --overwrite", async () => {
      // Add some data to the import pod
      await testDb
        .getDb()
        .none(
          "INSERT INTO stream (pod_name, name, user_id) VALUES ($(podName), $(name), $(userId))",
          {
            podName: importPodName,
            name: "existing-stream",
            userId: testUser.userId,
          },
        );

      const result = await cli.exec(
        ["import", importPodName, "--file", exportPath],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.not.equal(0);
      expect(result.stdout).to.include("already has");
      expect(result.stdout).to.include("Use --overwrite");
    });

    it("should allow overwriting with --overwrite flag", async () => {
      // Add some data to the import pod
      await testDb
        .getDb()
        .none(
          "INSERT INTO stream (pod_name, name, user_id) VALUES ($(podName), $(name), $(userId))",
          {
            podName: importPodName,
            name: "existing-stream",
            userId: testUser.userId,
          },
        );

      const result = await cli.exec(
        ["import", importPodName, "--file", exportPath, "--overwrite"],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include("✓ Import completed successfully");
    });

    it("should require file parameter", async () => {
      const result = await cli.exec(
        ["import", importPodName],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.not.equal(0);
      expect(result.stderr).to.include("specify input file");
    });

    it("should handle non-existent file", async () => {
      const result = await cli.exec(
        ["import", importPodName, "--file", "/tmp/nonexistent.json"],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.not.equal(0);
      expect(result.stderr).to.include("File not found");
    });

    it("should require authentication", async () => {
      const result = await cli.exec([
        "import",
        importPodName,
        "--file",
        exportPath,
      ]);

      expect(result.exitCode).to.not.equal(0);
      expect(result.stderr).to.include("Not authenticated");
    });
  });

  describe("export/import round trip", () => {
    it("should preserve all data in round trip", async () => {
      // Export original pod
      await cli.exec(
        ["export", testPodName, "--output", exportPath],
        { token: testToken },
      );

      // Create new pod and import
      const newPodName = `roundtrip-pod-${Date.now()}`;
      await testDb
        .getDb()
        .none("INSERT INTO pod (name, created_at) VALUES ($(name), NOW())", {
          name: newPodName,
        });

      await cli.exec(
        ["import", newPodName, "--file", exportPath],
        { token: testToken },
      );

      // Compare data
      const originalRecords = await testDb
        .getDb()
        .any(
          "SELECT stream_name, name, content FROM record WHERE pod_name = $(podName) ORDER BY stream_name, index",
          { podName: testPodName },
        );

      const importedRecords = await testDb
        .getDb()
        .any(
          "SELECT stream_name, name, content FROM record WHERE pod_name = $(podName) ORDER BY stream_name, index",
          { podName: newPodName },
        );

      expect(importedRecords).to.have.length(originalRecords.length);
      
      // Compare each record
      for (let i = 0; i < originalRecords.length; i++) {
        expect(importedRecords[i].stream_name).to.equal(originalRecords[i].stream_name);
        expect(importedRecords[i].name).to.equal(originalRecords[i].name);
        expect(importedRecords[i].content).to.equal(originalRecords[i].content);
      }
    });
  });
});