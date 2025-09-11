/**
 * CLI Stream Sync and Download Commands Tests
 */

import { expect } from "chai";
import fs from "fs/promises";
import path from "path";
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
  createTestStream,
  createOwnerConfig,
} from "../utils/test-data-helpers.js";

describe("CLI Stream Sync and Download Commands", function () {
  this.timeout(60000);

  let cli: CliTestHelper;
  let testPodName: string;
  let testDir: string;
  let downloadDir: string;

  before(async () => {
    await setupCliTests();
    cli = new CliTestHelper();
    await cli.setup();

    // Create temporary directories for testing
    testDir = path.join(process.cwd(), ".tests", "sync-test-files");
    downloadDir = path.join(process.cwd(), ".tests", "download-test-files");

    await fs.mkdir(path.dirname(testDir), { recursive: true });
    await fs.mkdir(path.dirname(downloadDir), { recursive: true });
  });

  after(async () => {
    await cli.cleanup();
    await cleanupCliTests();

    // Clean up test directories
    try {
      await fs.rm(testDir, { recursive: true, force: true });
      await fs.rm(downloadDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  beforeEach(async () => {
    await resetCliTestDb();

    // Create test pod name for this test
    testPodName = `test-sync-${Date.now()}`;

    // Clean up and recreate test directories
    try {
      await fs.rm(testDir, { recursive: true, force: true });
      await fs.rm(downloadDir, { recursive: true, force: true });
    } catch {
      // Ignore if directories don't exist
    }

    await fs.mkdir(testDir, { recursive: true });
    await fs.mkdir(downloadDir, { recursive: true });

    // Create test pod directly in database
    await testDb
      .getDb()
      .none("INSERT INTO pod (name, created_at) VALUES ($(name), NOW())", {
        name: testPodName,
      });

    // Set up owner config
    await createOwnerConfig(
      testDb.getDb(),
      testPodName,
      testUser.userId,
      testUser.userId,
    );
  });

  describe("Stream Sync Command", () => {
    it("should sync files from local directory to stream", async () => {
      // Create test files
      await fs.writeFile(path.join(testDir, "index.html"), "<h1>Homepage</h1>");
      await fs.writeFile(path.join(testDir, "about.md"), "# About Page");
      await fs.writeFile(
        path.join(testDir, "style.css"),
        "body { margin: 0; }",
      );

      // Create nested directory
      await fs.mkdir(path.join(testDir, "assets"), { recursive: true });
      await fs.writeFile(
        path.join(testDir, "assets", "script.js"),
        "console.log('hello');",
      );

      // Create the stream first using helper
      await createTestStream(testDb.getDb(), {
        podName: testPodName,
        streamPath: "website",
        userId: testUser.userId,
        accessPermission: "public",
      });

      // Sync directory to stream
      const result = await cli.exec(
        ["stream", "sync", testPodName, "website", testDir],
        {
          token: testToken,
        },
      );

      if (result.exitCode !== 0) {
        console.error("Sync failed:");
        console.error("stdout:", result.stdout);
        console.error("stderr:", result.stderr);
      }
      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include("Sync completed successfully");

      // Verify records were created
      const listResult = await cli.exec(
        ["record", "list", testPodName, "website", "--recursive"],
        {
          token: testToken,
        },
      );

      expect(listResult.exitCode).to.equal(0);
      expect(listResult.stdout).to.include("index");
      expect(listResult.stdout).to.include("about");
      expect(listResult.stdout).to.include("style");
      expect(listResult.stdout).to.include("script");
    });

    it("should handle dry run mode", async () => {
      // Create test files
      await fs.writeFile(path.join(testDir, "test.txt"), "Test content");

      // Create the stream first using helper
      await createTestStream(testDb.getDb(), {
        podName: testPodName,
        streamPath: "test-stream",
        userId: testUser.userId,
        accessPermission: "public",
      });

      // Run dry run
      const result = await cli.exec(
        ["stream", "sync", testPodName, "test-stream", testDir, "--dry-run"],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include("Files to upload:");
      expect(result.stdout).to.include("test.txt");

      // Verify no records were actually created
      const listResult = await cli.exec(
        ["record", "list", testPodName, "test-stream"],
        {
          token: testToken,
        },
      );

      expect(listResult.exitCode).to.equal(0);
      expect(listResult.stdout).to.include("No records found");
    });

    it("should handle incremental sync (only upload changed files)", async () => {
      // Initial sync
      await fs.writeFile(path.join(testDir, "file1.txt"), "Original content");
      await fs.writeFile(path.join(testDir, "file2.txt"), "Another file");

      // Create the stream first using helper
      await createTestStream(testDb.getDb(), {
        podName: testPodName,
        streamPath: "content",
        userId: testUser.userId,
        accessPermission: "public",
      });

      const initialResult = await cli.exec(
        ["stream", "sync", testPodName, "content", testDir, "--verbose"],
        {
          token: testToken,
        },
      );

      expect(initialResult.exitCode).to.equal(0);
      expect(initialResult.stdout).to.include(
        "Sync plan: 2 to upload, 0 to delete",
      );

      // Modify one file and add another
      await fs.writeFile(
        path.join(testDir, "file1.txt"),
        "Modified content - much longer",
      );
      await fs.writeFile(path.join(testDir, "file3.txt"), "New file");

      const secondResult = await cli.exec(
        ["stream", "sync", testPodName, "content", testDir, "--verbose"],
        {
          token: testToken,
        },
      );

      expect(secondResult.exitCode).to.equal(0);
      expect(secondResult.stdout).to.include(
        "Sync plan: 2 to upload, 0 to delete",
      );
      expect(secondResult.stdout).to.include("Uploading: file1.txt");
      expect(secondResult.stdout).to.include("Uploading: file3.txt");
    });

    it("should delete records for files that no longer exist locally", async () => {
      // Initial sync with multiple files
      await fs.writeFile(path.join(testDir, "keep.txt"), "Keep this file");
      await fs.writeFile(path.join(testDir, "delete.txt"), "Delete this file");

      // Create the stream first using helper
      await createTestStream(testDb.getDb(), {
        podName: testPodName,
        streamPath: "cleanup",
        userId: testUser.userId,
        accessPermission: "public",
      });

      const initialResult = await cli.exec(
        ["stream", "sync", testPodName, "cleanup", testDir],
        {
          token: testToken,
        },
      );

      expect(initialResult.exitCode).to.equal(0);

      // Remove one file locally
      await fs.unlink(path.join(testDir, "delete.txt"));

      const cleanupResult = await cli.exec(
        ["stream", "sync", testPodName, "cleanup", testDir, "--verbose"],
        {
          token: testToken,
        },
      );

      expect(cleanupResult.exitCode).to.equal(0);
      expect(cleanupResult.stdout).to.include(
        "Sync plan: 0 to upload, 1 to delete",
      );
      expect(cleanupResult.stdout).to.include("Deleting:");

      // Verify the record was deleted
      const listResult = await cli.exec(
        ["record", "list", testPodName, "cleanup", "--unique"],
        {
          token: testToken,
        },
      );

      expect(listResult.exitCode).to.equal(0);
      expect(listResult.stdout).to.include("keep");
      expect(listResult.stdout).to.not.include("delete");
    });

    it("should skip hidden files", async () => {
      // Create regular and hidden files
      await fs.writeFile(path.join(testDir, "visible.txt"), "Visible file");
      await fs.writeFile(path.join(testDir, ".hidden"), "Hidden file");
      await fs.writeFile(path.join(testDir, ".gitignore"), "*.log");

      // Create the stream first using helper
      await createTestStream(testDb.getDb(), {
        podName: testPodName,
        streamPath: "files",
        userId: testUser.userId,
        accessPermission: "public",
      });

      const result = await cli.exec(
        ["stream", "sync", testPodName, "files", testDir, "--verbose"],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include("Sync plan: 1 to upload");

      const listResult = await cli.exec(
        ["record", "list", testPodName, "files"],
        {
          token: testToken,
        },
      );

      expect(listResult.exitCode).to.equal(0);
      expect(listResult.stdout).to.include("visible");
      expect(listResult.stdout).to.not.include("hidden");
      expect(listResult.stdout).to.not.include("gitignore");
    });
  });

  describe("Stream Download Command", () => {
    beforeEach(async () => {
      // Create test stream with some records using the helper
      await createTestStream(testDb.getDb(), {
        podName: testPodName,
        streamPath: "downloads",
        userId: testUser.userId,
        accessPermission: "public",
      });

      // Add some test records manually
      await cli.exec(
        [
          "record",
          "write",
          testPodName,
          "downloads",
          "home",
          "Welcome to my site",
        ],
        { token: testToken },
      );

      await cli.exec(
        ["record", "write", testPodName, "downloads", "about", "About us page"],
        { token: testToken },
      );

      await cli.exec(
        [
          "record",
          "write",
          testPodName,
          "downloads",
          "contact",
          "Contact information",
        ],
        { token: testToken },
      );
    });

    it("should download all records from stream to local directory", async () => {
      const result = await cli.exec(
        ["stream", "download", testPodName, "downloads", downloadDir],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include("Download completed!");
      expect(result.stdout).to.include("3 files downloaded");

      // Verify files were created
      const files = await fs.readdir(downloadDir);
      expect(files).to.include("home");
      expect(files).to.include("about");
      expect(files).to.include("contact");

      // Verify file contents
      const homeContent = await fs.readFile(
        path.join(downloadDir, "home"),
        "utf8",
      );
      expect(homeContent).to.equal("Welcome to my site");
    });

    it("should handle verbose output", async () => {
      const result = await cli.exec(
        [
          "stream",
          "download",
          testPodName,
          "downloads",
          downloadDir,
          "--verbose",
        ],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include("Found 3 records to download");
      expect(result.stdout).to.include("Downloading: home");
      expect(result.stdout).to.include("Downloading: about");
      expect(result.stdout).to.include("Downloading: contact");
    });

    it("should skip existing files without overwrite flag", async () => {
      // Create a file that already exists
      await fs.writeFile(path.join(downloadDir, "home"), "Existing content");

      const result = await cli.exec(
        [
          "stream",
          "download",
          testPodName,
          "downloads",
          downloadDir,
          "--verbose",
        ],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include("2 files downloaded");
      expect(result.stdout).to.include("1 files skipped");
      expect(result.stdout).to.include("Skipped existing file: home");

      // Verify existing file wasn't overwritten
      const content = await fs.readFile(path.join(downloadDir, "home"), "utf8");
      expect(content).to.equal("Existing content");
    });

    it("should overwrite existing files with overwrite flag", async () => {
      // Create a file that already exists
      await fs.writeFile(path.join(downloadDir, "home"), "Existing content");

      const result = await cli.exec(
        [
          "stream",
          "download",
          testPodName,
          "downloads",
          downloadDir,
          "--overwrite",
          "--verbose",
        ],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include("3 files downloaded");
      expect(result.stdout).to.not.include("skipped");

      // Verify file was overwritten
      const content = await fs.readFile(path.join(downloadDir, "home"), "utf8");
      expect(content).to.equal("Welcome to my site");
    });

    it("should handle empty streams gracefully", async () => {
      await createTestStream(testDb.getDb(), {
        podName: testPodName,
        streamPath: "empty-stream",
        userId: testUser.userId,
        accessPermission: "public",
      });

      const result = await cli.exec(
        ["stream", "download", testPodName, "empty-stream", downloadDir],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include("No records found in stream");

      // Verify directory was created but is empty
      const files = await fs.readdir(downloadDir);
      expect(files).to.have.length(0);
    });
  });

  describe("Round-trip Sync and Download", () => {
    it("should maintain file integrity in round-trip sync/download operations", async () => {
      // Create original test files with various content types
      const testFiles = {
        "index.html": "<html><body><h1>Test Site</h1></body></html>",
        "style.css": "body { font-family: Arial; color: #333; }",
        "script.js": "function hello() { console.log('Hello World!'); }",
        "data.json": JSON.stringify({ users: [{ name: "John", age: 30 }] }),
        "readme.md": "# Project Title\n\nThis is a test project.",
      };

      // Create original files
      for (const [filename, content] of Object.entries(testFiles)) {
        await fs.writeFile(path.join(testDir, filename), content);
      }

      // Create the stream first using helper
      await createTestStream(testDb.getDb(), {
        podName: testPodName,
        streamPath: "roundtrip",
        userId: testUser.userId,
        accessPermission: "public",
      });

      // Sync to stream
      const syncResult = await cli.exec(
        ["stream", "sync", testPodName, "roundtrip", testDir],
        {
          token: testToken,
        },
      );

      expect(syncResult.exitCode).to.equal(0);

      // Download back to different directory
      const downloadResult = await cli.exec(
        [
          "stream",
          "download",
          testPodName,
          "roundtrip",
          downloadDir,
          "--overwrite",
        ],
        {
          token: testToken,
        },
      );

      expect(downloadResult.exitCode).to.equal(0);

      // Verify all files were downloaded and content matches
      for (const [filename, expectedContent] of Object.entries(testFiles)) {
        const downloadedContent = await fs.readFile(
          path.join(downloadDir, path.parse(filename).name), // Record names don't include extensions
          "utf8",
        );
        expect(downloadedContent).to.equal(expectedContent);
      }
    });
  });
});
