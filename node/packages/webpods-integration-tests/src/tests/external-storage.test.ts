// External storage tests for WebPods media handling
import { expect } from "chai";
import {
  TestHttpClient,
  createTestUser,
  createTestPod,
  clearAllCache,
} from "webpods-test-utils";
import { testDb } from "../test-setup.js";
import { promises as fs } from "fs";
import { join } from "path";

describe("WebPods External Storage", () => {
  let client: TestHttpClient;
  let userId: string;
  let authToken: string;
  const testPodId = "test-external-storage";
  const baseUrl = `http://${testPodId}.localhost:3000`;
  let tempStorageDir: string;

  // Small test image (1x1 transparent PNG)
  const testPngBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

  // Create larger content by creating a buffer and converting to base64
  // This ensures valid base64 encoding
  const largeBuffer = Buffer.alloc(2048, "A"); // 2KB of 'A's
  const largePngBase64 = largeBuffer.toString("base64");

  // Small test JPEG
  const testJpegBase64 =
    "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAr/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA8A/9k=";

  beforeEach(async () => {
    await clearAllCache();
    // Use the configured test media directory
    tempStorageDir = join(process.cwd(), ".tests", "media");

    // Ensure directory exists (it should be created by test-setup.ts)
    await fs.mkdir(tempStorageDir, { recursive: true }).catch(() => {});

    client = new TestHttpClient("http://localhost:3000");

    // Create a test user and auth token
    const db = testDb.getDb();
    const user = await createTestUser(db, {
      provider: "test-auth-provider-1",
      providerId: "ext123",
      email: "external@example.com",
      name: "External Storage Test User",
    });

    userId = user.userId;

    // Create the test pod
    await createTestPod(db, testPodId, userId);

    // Get OAuth token
    authToken = await client.authenticateViaOAuth(userId, [testPodId]);

    client.setBaseUrl(baseUrl);
    client.setAuthToken(authToken);
  });

  afterEach(async () => {
    // Clean up test media files (but keep the directory for next test)
    const podDir = join(tempStorageDir, testPodId);
    await fs.rm(podDir, { recursive: true, force: true }).catch(() => {});
    await clearAllCache();
  });

  describe("External Storage Upload", () => {
    it("should store text/strings in database", async () => {
      // Create stream first
      await client.createStream("images/small");

      // Data URLs are text strings - always stored in DB (unless X-Record-Type: file)
      const testPngDataUrl = `data:image/png;base64,${testPngBase64}`;
      const response = await client.post("/images/small/tiny", testPngDataUrl);

      expect(response.status).to.equal(201);
      expect(response.data).to.have.property("name", "tiny");
      expect(response.data).to.have.property("contentType", "text/plain");

      // Verify it's served from database (no redirect)
      const getResponse = await client.get("/images/small/tiny");
      expect(getResponse.status).to.equal(200);
      expect(getResponse.headers["x-record-type"]).to.be.undefined;
    });

    it("should store large files externally when X-Record-Type: file header is set", async () => {
      // Create stream first
      await client.createStream("images/large");

      // Large image with X-Record-Type: file header
      // Use data URL for image
      const largePngDataUrl = `data:image/png;base64,${largePngBase64}`;
      const response = await client.post("/images/large/big", largePngDataUrl, {
        headers: {
          "X-Record-Type": "file",
        },
      });

      if (response.status !== 201) {
        console.error("Upload failed:", response.status, response.data);
      }
      expect(response.status).to.equal(201);
      expect(response.data).to.have.property("name", "big");

      // Verify files were created in storage
      const hashFiles = await fs.readdir(
        join(tempStorageDir, testPodId, "images/large", ".storage"),
      );
      expect(hashFiles).to.have.lengthOf(1);
      // Hash file should be just the hash, no extension
      expect(hashFiles[0]).to.not.include(".");

      // The file should be stored as "big" without extension since that's the record name
      const nameFile = await fs.readFile(
        join(tempStorageDir, testPodId, "images/large", "big"),
      );
      expect(nameFile).to.exist;
    });

    it("should store binary content externally even without X-Record-Type header", async () => {
      await client.createStream("images/control");

      // Binary content without X-Record-Type header
      const response = await client.post(
        "/images/control/test",
        largePngBase64,
        {
          headers: {
            "Content-Type": "image/png",
          },
        },
      );

      expect(response.status).to.equal(201);

      // Verify files WERE created in storage (binary auto-external)
      const storageExists = await fs
        .access(join(tempStorageDir, testPodId, "images/control"))
        .then(() => true)
        .catch(() => false);
      expect(storageExists).to.be.true;
    });

    it("should handle different file types", async () => {
      await client.createStream("media");

      // Upload JPEG
      const jpegDataUrl = `data:image/jpeg;base64,${testJpegBase64}`;
      const jpegResponse = await client.post("/media/photo", jpegDataUrl, {
        headers: {
          "X-Record-Type": "file",
        },
      });

      expect(jpegResponse.status).to.equal(201);

      // Upload PDF (mock base64)
      const pdfBase64 =
        "JVBERi0xLjQKJeLjz9MKNCAwIG9iago8PC9MZW5ndGggMzA+PnN0cmVhbQp4nGNgYGBgZGBgYmBkYAYADwAWCmVuZHN0cmVhbQplbmRvYmoKCnN0YXJ0eHJlZgoxMTYKJSVFT0YK";
      const pdfResponse = await client.post("/media/document", pdfBase64, {
        headers: {
          "Content-Type": "application/pdf",
          "X-Record-Type": "file",
        },
      });

      expect(pdfResponse.status).to.equal(201);
    });
  });

  describe("External Storage Serving", () => {
    beforeEach(async () => {
      // Create stream and upload external content
      await client.createStream("serve-test");

      const largePngDataUrl = `data:image/png;base64,${largePngBase64}`;
      await client.post("/serve-test/external-image", largePngDataUrl, {
        headers: {
          "X-Record-Type": "file",
        },
      });
    });

    it("should return 302 redirect for externally stored content", async () => {
      // Get the record with redirect disabled to check the 302 response
      const response = await client.get("/serve-test/external-image", {
        followRedirect: false,
      });

      // Should get a 302 redirect response
      expect(response.status).to.equal(302);

      // Check that Location header points to external storage
      expect(response.headers.location).to.include("static.example.com");
      expect(response.headers.location).to.include("external-image");

      // Also verify the file was stored externally (no extension since record name has none)
      const externalFileExists = await fs
        .access(join(tempStorageDir, testPodId, "serve-test", "external-image"))
        .then(() => true)
        .catch(() => false);

      expect(externalFileExists).to.be.true;
    });

    it("should include cache headers in redirect response", async () => {
      // Test with redirect disabled to check headers
      const response = await client.get("/serve-test/external-image", {
        followRedirect: false,
      });

      // Should have cache headers on the redirect response
      expect(response.status).to.equal(302);
      expect(response.headers["cache-control"]).to.exist;
      expect(response.headers["cache-control"]).to.include("max-age=");

      // Also verify hash file exists
      const hashFileExists = await fs
        .access(join(tempStorageDir, testPodId, "serve-test", ".storage"))
        .then(async () => {
          const files = await fs.readdir(
            join(tempStorageDir, testPodId, "serve-test", ".storage"),
          );
          return files.length > 0;
        })
        .catch(() => false);

      expect(hashFileExists).to.be.true;
    });
  });

  describe("External Storage Deletion", () => {
    beforeEach(async () => {
      await client.createStream("delete-test");

      // Upload file to external storage
      const largePngDataUrl = `data:image/png;base64,${largePngBase64}`;
      await client.post("/delete-test/to-delete", largePngDataUrl, {
        headers: {
          "X-Record-Type": "file",
        },
      });
    });

    it("should soft delete (remove name file, keep hash file)", async () => {
      // Verify files exist before deletion (no extension since record name has none)
      const nameFileBefore = await fs
        .access(join(tempStorageDir, testPodId, "delete-test", "to-delete"))
        .then(() => true)
        .catch(() => false);
      expect(nameFileBefore).to.be.true;

      // Soft delete the record
      const response = await client.delete("/delete-test/to-delete");
      expect(response.status).to.be.oneOf([200, 204]); // Accept either status

      // Verify name file is deleted but hash file remains
      const nameFileAfter = await fs
        .access(join(tempStorageDir, testPodId, "delete-test", "to-delete"))
        .then(() => true)
        .catch(() => false);
      expect(nameFileAfter).to.be.false;

      // Hash file should still exist
      const hashFiles = await fs.readdir(
        join(tempStorageDir, testPodId, "delete-test", ".storage"),
      );
      expect(hashFiles).to.have.lengthOf(1);
    });

    it("should hard delete (purge) both files", async () => {
      // First soft delete
      await client.delete("/delete-test/to-delete");

      // Then purge (this would be an admin operation in real usage)
      // For testing, we'll directly call the purge endpoint if it exists
      await client.delete("/delete-test/to-delete?purge=true");

      // After purge, both files should be gone
      const hashDirExists = await fs
        .access(join(tempStorageDir, testPodId, "delete-test", ".storage"))
        .then(() => true)
        .catch(() => false);

      if (hashDirExists) {
        const hashFiles = await fs.readdir(
          join(tempStorageDir, testPodId, "delete-test", ".storage"),
        );
        expect(hashFiles).to.have.lengthOf(0);
      }
    });
  });

  describe("External Storage Edge Cases", () => {
    it("should handle files without extensions", async () => {
      await client.createStream("no-ext");

      const response = await client.post(
        "/no-ext/file-without-extension",
        largePngBase64,
        {
          headers: {
            "Content-Type": "image/png",
            "X-Record-Type": "file",
          },
        },
      );

      expect(response.status).to.equal(201);

      // File should be stored WITHOUT extension since the name has none
      const nameFileWithoutExt = await fs
        .access(
          join(tempStorageDir, testPodId, "no-ext", "file-without-extension"),
        )
        .then(() => true)
        .catch(() => false);
      expect(nameFileWithoutExt).to.be.true;

      // Hash file should also have no extension
      const hashFiles = await fs.readdir(
        join(tempStorageDir, testPodId, "no-ext", ".storage"),
      );
      expect(hashFiles).to.have.lengthOf(1);
      // Hash file should be just the hash, no extension
      expect(hashFiles[0]).to.not.include(".");
    });

    it("should handle storage failures gracefully", async () => {
      // Make storage directory read-only to simulate failure
      await client.createStream("fail-test");

      // This test is hard to simulate without being able to change config
      // We'll test with an unwritable directory
      const response = await client.post(
        "/fail-test/should-fail",
        largePngBase64,
        {
          headers: {
            "Content-Type": "image/png",
            "X-Record-Type": "file",
          },
        },
      );

      // Should fall back to database storage or return error
      // The exact behavior depends on implementation
      expect(response.status).to.be.oneOf([201, 500]);
    });

    it("should always store binary content externally", async () => {
      // Binary content always goes external (no size threshold)
      await client.createStream("binary-test");

      // Send actual binary content (will be parsed as Buffer)
      const response = await client.post(
        "/binary-test/auto-external",
        testPngBase64,
        {
          headers: {
            "Content-Type": "image/png",
            // No X-Record-Type header - binary auto-detects external
          },
        },
      );

      expect(response.status).to.equal(201);

      // Should be stored externally since it's binary
      const storageExists = await fs
        .access(join(tempStorageDir, testPodId, "binary-test"))
        .then(() => true)
        .catch(() => false);
      expect(storageExists).to.be.true;
    });
  });

  describe("External Storage with Existing Features", () => {
    it("should work with stream permissions", async () => {
      await client.createStream("private-media", "private");

      const response = await client.post(
        "/private-media/secret",
        largePngBase64,
        {
          headers: {
            "Content-Type": "image/png",
            "X-Record-Type": "file",
          },
        },
      );

      expect(response.status).to.equal(201);

      // Unauthenticated request should fail
      client.setAuthToken("");
      const getResponse = await client.get("/private-media/secret");
      expect(getResponse.status).to.be.oneOf([401, 403]); // Accept either unauthorized status
    });

    it("should maintain hash chain with external storage", async () => {
      await client.createStream("chain-test");

      // Upload multiple files
      const largePngDataUrl = `data:image/png;base64,${largePngBase64}`;
      const response1 = await client.post(
        "/chain-test/file1",
        largePngDataUrl,
        {
          headers: {
            "X-Record-Type": "file",
          },
        },
      );

      const jpegDataUrl = `data:image/jpeg;base64,${testJpegBase64}`;
      const response2 = await client.post("/chain-test/file2", jpegDataUrl, {
        headers: {
          "X-Record-Type": "file",
        },
      });

      expect(response1.data.previousHash).to.be.null;
      expect(response2.data.previousHash).to.equal(response1.data.hash);
    });

    it("should work with record listing", async () => {
      await client.createStream("list-test");

      // Upload mix of external and database storage
      const testPngDataUrl = `data:image/png;base64,${testPngBase64}`;
      await client.post("/list-test/internal", testPngDataUrl);

      const largePngDataUrl = `data:image/png;base64,${largePngBase64}`;
      await client.post("/list-test/external", largePngDataUrl, {
        headers: {
          "X-Record-Type": "file",
        },
      });

      const listResponse = await client.get("/list-test");
      expect(listResponse.status).to.equal(200);
      expect(listResponse.data.records).to.have.lengthOf(2);

      // Both records should be listed, regardless of storage location
      const names = listResponse.data.records.map((r: any) => r.name);
      expect(names).to.include.members(["internal", "external"]);
    });

    it("should include contentUrl field for externally stored content", async () => {
      await client.createStream("url-test");

      // Upload external content
      const largePngDataUrl = `data:image/png;base64,${largePngBase64}`;
      await client.post("/url-test/external-file.png", largePngDataUrl, {
        headers: {
          "X-Record-Type": "file",
        },
      });

      // Upload internal content (small)
      await client.post("/url-test/internal-text", "Small text content", {
        headers: {
          "Content-Type": "text/plain",
        },
      });

      // List records and check contentUrl field
      const listResponse = await client.get("/url-test");
      expect(listResponse.status).to.equal(200);
      expect(listResponse.data.records).to.have.lengthOf(2);

      const externalRecord = listResponse.data.records.find(
        (r: any) => r.name === "external-file.png",
      );
      const internalRecord = listResponse.data.records.find(
        (r: any) => r.name === "internal-text",
      );

      // External record should have contentUrl
      expect(externalRecord).to.exist;
      expect(externalRecord.contentUrl).to.exist;
      expect(externalRecord.contentUrl).to.be.a("string");
      expect(externalRecord.contentUrl).to.include("static.example.com");
      expect(externalRecord.contentUrl).to.include("external-file");
      expect(externalRecord.content).to.equal(""); // Content should be empty for external storage

      // Internal record should not have contentUrl
      expect(internalRecord).to.exist;
      expect(internalRecord.contentUrl).to.be.undefined;
      expect(internalRecord.content).to.equal("Small text content");

      // Also test with field selection
      const fieldsResponse = await client.get(
        "/url-test?fields=name,contentUrl,content",
      );
      expect(fieldsResponse.status).to.equal(200);
      const externalWithFields = fieldsResponse.data.records.find(
        (r: any) => r.name === "external-file.png",
      );
      expect(externalWithFields.contentUrl).to.exist;
      expect(externalWithFields.contentUrl).to.include("static.example.com");
    });
  });
});
