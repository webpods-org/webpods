// Name validation tests for WebPods
import { expect } from "chai";
import { TestHttpClient, createTestUser } from "webpods-test-utils";
import { testDb } from "../test-setup.js";

describe("WebPods Name Validation", () => {
  let client: TestHttpClient;
  let authToken: string;
  const testPodId = "test-names";
  const baseUrl = `http://${testPodId}.localhost:3000`;

  beforeEach(async () => {
    client = new TestHttpClient("http://localhost:3000");
    // Create a test user and auth token
    const db = testDb.getDb();
    const user = await createTestUser(db, {
      provider: "testprovider1",
      providerId: "name123",
      email: "name@example.com",
      name: "Name Test User",
    });

    // Generate pod-specific token
    client.setBaseUrl(baseUrl);
    authToken = client.generatePodToken(
      {
        user_id: user.userId,
        email: user.email,
        name: user.name,
      },
      testPodId,
    );

    client.setAuthToken(authToken);
  });

  describe("Valid Names", () => {
    it("should accept simple alphanumeric names", async () => {
      const validNames = ["simple", "test123", "ABC", "12345", "MixedCase123"];

      for (const name of validNames) {
        const response = await client.post(
          `/stream/${name}`,
          `Content for ${name}`,
        );
        if (response.status !== 201) {
          console.error("Error for name:", name, response.data);
        }
        expect(response.status).to.equal(201, `Failed for name: ${name}`);
        expect(response.data).to.have.property("name", name);
      }
    });

    it("should accept names with hyphens and underscores", async () => {
      const validNames = [
        "my-name",
        "test_name",
        "mixed-with_both",
        "kebab-case-example",
        "snake_case_example",
      ];

      for (const name of validNames) {
        const response = await client.post(
          `/hyphen-underscore/${name}`,
          `Content for ${name}`,
        );
        expect(response.status).to.equal(201, `Failed for name: ${name}`);
        expect(response.data).to.have.property("name", name);
      }
    });

    it("should accept names with periods (but not at start/end)", async () => {
      const validNames = [
        "file.txt",
        "index.html",
        "logo.png",
        "archive.tar.gz",
        "v1.2.3",
        "data.backup.2024",
      ];

      for (const name of validNames) {
        const response = await client.post(
          `/files/${name}`,
          `Content for ${name}`,
        );
        expect(response.status).to.equal(201, `Failed for name: ${name}`);
        expect(response.data).to.have.property("name", name);
      }
    });

    it("should accept maximum length names", async () => {
      // 256 characters is the max
      const longName = "a".repeat(256);
      const response = await client.post(`/long/${longName}`, "Content");
      expect(response.status).to.equal(201);
      expect(response.data).to.have.property("name", longName);
    });
  });

  describe("Invalid Names", () => {
    it("should reject names with slashes", async () => {
      const invalidNames = [
        "path/to/file",
        "folder/image.png",
        "../etc/passwd",
        "../../admin",
        "file\\name",
        "/absolute/path",
      ];

      for (const name of invalidNames) {
        const response = await client.post(
          `/invalid-slash/${encodeURIComponent(name)}`,
          "Content",
        );
        expect(response.status).to.equal(400, `Should reject name: ${name}`);
        expect(response.data.error.code).to.equal("INVALID_NAME");
        expect(response.data.error.message).to.include("can only contain");
      }
    });

    it("should reject names starting or ending with periods", async () => {
      const invalidNames = [
        ".hidden",
        "file.",
        "..",
        ".",
        ".start.middle",
        "middle.end.",
      ];

      for (const name of invalidNames) {
        const response = await client.post(
          `/invalid-period/${encodeURIComponent(name)}`,
          "Content",
        );
        expect(response.status).to.equal(400, `Should reject name: ${name}`);
        // Express normalizes "." and ".." as directory navigation (empty in this case)
        if (name === "." || name === "..") {
          expect(response.data.error.code).to.equal("MISSING_NAME");
        } else {
          expect(response.data.error.code).to.equal("INVALID_NAME");
        }
      }
    });

    it("should reject names with special characters", async () => {
      const invalidNames = [
        "hello world", // space
        "file@name", // @
        "price$100", // $
        "50%off", // %
        "question?", // ?
        "file*pattern", // *
        "a:b", // :
        'quote"test', // "
        "less<more", // <
        "pipe|test", // |
        "hash#tag", // #
        "plus+minus", // +
        "equal=sign", // =
        "bracket[0]", // []
        "curly{brace}", // {}
        "exclaim!", // !
        "tilde~test", // ~
        "back`tick", // `
        "semi;colon", // ;
        "paren(test)", // ()
        "and&test", // &
        "caret^test", // ^
      ];

      for (const name of invalidNames) {
        const response = await client.post(
          `/invalid-special/${encodeURIComponent(name)}`,
          "Content",
        );
        expect(response.status).to.equal(400, `Should reject name: ${name}`);
        expect(response.data.error.code).to.equal("INVALID_NAME");
      }
    });

    it("should reject empty name", async () => {
      const response = await client.post("/empty/", "Content");
      expect(response.status).to.equal(400);
      expect(response.data.error.code).to.equal("MISSING_NAME");
    });

    it("should reject name exceeding maximum length", async () => {
      const tooLongName = "a".repeat(257); // 257 characters
      const response = await client.post(`/toolong/${tooLongName}`, "Content");
      expect(response.status).to.equal(400);
      expect(response.data.error.code).to.equal("INVALID_NAME");
    });
  });

  describe("Name Access Patterns", () => {
    it("should correctly route to stream with valid name", async () => {
      // Create records with valid names
      await client.post("/products/laptop-2024", "Laptop details");
      await client.post("/products/phone_v2", "Phone details");
      await client.post("/products/tablet.pro", "Tablet details");

      // Access them
      let response = await client.get("/products/laptop-2024");
      expect(response.status).to.equal(200);
      expect(response.data).to.equal("Laptop details");

      response = await client.get("/products/phone_v2");
      expect(response.status).to.equal(200);
      expect(response.data).to.equal("Phone details");

      response = await client.get("/products/tablet.pro");
      expect(response.status).to.equal(200);
      expect(response.data).to.equal("Tablet details");
    });

    it("should handle nested streams with names correctly", async () => {
      // Create nested stream with name
      await client.post("/docs/api/v1/intro.md", "API Introduction");
      await client.post("/docs/api/v1/auth.html", "Authentication Guide");

      // Access them - clear that "intro.md" is an name, not a path
      let response = await client.get("/docs/api/v1/intro.md");
      expect(response.status).to.equal(200);
      expect(response.data).to.equal("API Introduction");

      response = await client.get("/docs/api/v1/auth.html");
      expect(response.status).to.equal(200);
      expect(response.data).to.equal("Authentication Guide");
    });
  });

  describe("Security", () => {
    it("should prevent path traversal attempts via names", async () => {
      // These should all be rejected at write time
      const attacks = [
        "../../etc/passwd",
        "../../../root/.ssh/id_rsa",
        "valid/../../../etc/shadow",
        "./../admin",
      ];

      for (const attack of attacks) {
        const response = await client.post(
          `/secure/${encodeURIComponent(attack)}`,
          "Evil content",
        );
        expect(response.status).to.equal(400, `Should block: ${attack}`);
        expect(response.data.error.code).to.equal("INVALID_NAME");
      }
    });

    it("should not allow URL hijacking through name manipulation", async () => {
      // Create a legitimate record
      await client.post("/pages/home", "Real homepage");

      // Try to create confusing names that might hijack URLs
      const hijackAttempts = [
        "home/../../admin", // Contains slashes - rejected
        "home%2F..%2Fadmin", // URL encoded slashes - rejected as special chars
        "home/../admin", // Path traversal - rejected
      ];

      for (const attempt of hijackAttempts) {
        const response = await client.post(
          `/pages/${encodeURIComponent(attempt)}`,
          "Hijack attempt",
        );
        expect(response.status).to.equal(400, `Should block: ${attempt}`);
      }
    });
  });
});
