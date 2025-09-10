import { describe, it, before, after, beforeEach } from "mocha";
import { expect } from "chai";
import { CliTestHelper } from "../cli-test-helpers.js";
import {
  setupCliTests,
  cleanupCliTests,
  resetCliTestDb,
  testToken,
  testDb,
} from "../test-setup.js";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

describe("CLI Schema Commands", () => {
  let cli: CliTestHelper;
  let testPodName: string;
  let tempDir: string;

  before(async () => {
    await setupCliTests();
    cli = new CliTestHelper();
    await cli.setup();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "schema-test-"));
  });

  after(async () => {
    await cleanupCliTests();
    await cli.cleanup();
    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await resetCliTestDb();
    testPodName = `test-pod-${Date.now()}`;

    // Create test pod
    await testDb
      .getDb()
      .none(`INSERT INTO pod (name, created_at) VALUES ($(podName), NOW())`, {
        podName: testPodName,
      });
  });

  describe("schema enable command", () => {
    it("should enable schema validation for a stream", async () => {
      // Create a schema file
      const schemaFile = path.join(tempDir, "test-schema.json");
      const schema = {
        type: "object",
        properties: {
          title: { type: "string", minLength: 1 },
          content: { type: "string" },
        },
        required: ["title", "content"],
      };
      await fs.writeFile(schemaFile, JSON.stringify(schema, null, 2));

      // Enable schema
      const result = await cli.exec(
        ["schema", "enable", `${testPodName}/blog/posts`, schemaFile],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include("Schema enabled");

      // Verify schema was written to .config/schema
      const records = await testDb.getDb().manyOrNone(
        `SELECT r.* FROM record r
         INNER JOIN stream s ON r.stream_id = s.id
         WHERE s.pod_name = $(podName) AND s.path = $(path) AND r.name = 'schema'
         ORDER BY r.index`,
        { podName: testPodName, path: "blog/posts/.config" },
      );

      expect(records).to.have.length(1);
      const schemaRecord = JSON.parse(records[0].content);
      expect(schemaRecord.schemaType).to.equal("json-schema");
      expect(schemaRecord.schema).to.deep.equal(schema);
    });

    it("should set validation mode", async () => {
      const schemaFile = path.join(tempDir, "mode-schema.json");
      await fs.writeFile(schemaFile, JSON.stringify({ type: "object" }));

      const result = await cli.exec(
        [
          "schema",
          "enable",
          `${testPodName}/api/data`,
          schemaFile,
          "--mode",
          "permissive",
        ],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);

      // Check the written schema
      const records = await testDb.getDb().manyOrNone(
        `SELECT r.* FROM record r
         INNER JOIN stream s ON r.stream_id = s.id
         WHERE s.pod_name = $(podName) AND s.path = $(path) AND r.name = 'schema'`,
        { podName: testPodName, path: "api/data/.config" },
      );

      const schemaRecord = JSON.parse(records[0].content);
      expect(schemaRecord.validationMode).to.equal("permissive");
    });

    it("should fail with invalid JSON schema file", async () => {
      const invalidFile = path.join(tempDir, "invalid.json");
      await fs.writeFile(invalidFile, "not valid json");

      const result = await cli.exec(
        ["schema", "enable", `${testPodName}/test`, invalidFile],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(1);
      expect(result.stderr).to.include("Invalid JSON");
    });

    it("should fail with non-existent schema file", async () => {
      const result = await cli.exec(
        ["schema", "enable", `${testPodName}/test`, "/does/not/exist.json"],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(1);
      expect(result.stderr).to.include("not found");
    });

    it("should require authentication", async () => {
      const schemaFile = path.join(tempDir, "auth-test.json");
      await fs.writeFile(schemaFile, JSON.stringify({ type: "object" }));

      const result = await cli.exec(
        ["schema", "enable", `${testPodName}/test`, schemaFile],
        {
          // No token provided
        },
      );

      expect(result.exitCode).to.equal(1);
      expect(result.stderr).to.include("Not authenticated");
    });
  });

  describe("schema disable command", () => {
    it("should disable schema validation for a stream", async () => {
      // First enable a schema
      const schemaFile = path.join(tempDir, "disable-test.json");
      await fs.writeFile(
        schemaFile,
        JSON.stringify({
          type: "object",
          properties: { name: { type: "string" } },
        }),
      );

      await cli.exec(["schema", "enable", `${testPodName}/users`, schemaFile], {
        token: testToken,
      });

      // Now disable it
      const result = await cli.exec(
        ["schema", "disable", `${testPodName}/users`],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include("Schema disabled");

      // Verify schemaType is "none"
      const records = await testDb.getDb().manyOrNone(
        `SELECT r.* FROM record r
         INNER JOIN stream s ON r.stream_id = s.id
         WHERE s.pod_name = $(podName) AND s.path = $(path) AND r.name = 'schema'
         ORDER BY r.index DESC
         LIMIT 1`,
        { podName: testPodName, path: "users/.config" },
      );

      expect(records).to.have.length(1);
      const schemaRecord = JSON.parse(records[0].content);
      expect(schemaRecord.schemaType).to.equal("none");
    });

    it("should work even if no schema was previously set", async () => {
      const result = await cli.exec(
        ["schema", "disable", `${testPodName}/newstream`],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include("Schema disabled");
    });

    it("should require authentication", async () => {
      const result = await cli.exec(
        ["schema", "disable", `${testPodName}/test`],
        {
          // No token provided
        },
      );

      expect(result.exitCode).to.equal(1);
      expect(result.stderr).to.include("Not authenticated");
    });
  });

  describe("schema validation with record writes", () => {
    it("should enforce schema when enabled", async () => {
      // Enable strict schema
      const schemaFile = path.join(tempDir, "strict-schema.json");
      const schema = {
        type: "object",
        properties: {
          name: { type: "string", minLength: 1 },
          age: { type: "number", minimum: 0 },
        },
        required: ["name", "age"],
      };
      await fs.writeFile(schemaFile, JSON.stringify(schema));

      const enableResult = await cli.exec(
        ["schema", "enable", `${testPodName}/people`, schemaFile],
        {
          token: testToken,
        },
      );
      expect(enableResult.exitCode).to.equal(0);

      // Valid data should succeed
      let result = await cli.exec(
        [
          "write",
          testPodName,
          "people",
          "person1",
          JSON.stringify({ name: "Alice", age: 30 }),
        ],
        {
          token: testToken,
        },
      );
      expect(result.exitCode).to.equal(0);

      // Invalid data should fail - write to the same stream with a different name
      result = await cli.exec(
        [
          "write",
          testPodName,
          "people",
          "person2",
          JSON.stringify({ name: "Bob" }), // missing age
        ],
        {
          token: testToken,
          // Don't set CLI_SILENT - let it use defaults
        },
      );
      expect(result.exitCode).to.equal(1);
      expect(result.stderr).to.include("VALIDATION_ERROR");
    });

    it("should allow any data when schema is disabled", async () => {
      // Enable then disable schema
      const schemaFile = path.join(tempDir, "temp-schema.json");
      await fs.writeFile(
        schemaFile,
        JSON.stringify({
          type: "object",
          properties: { strict: { type: "boolean" } },
          required: ["strict"],
        }),
      );

      await cli.exec(
        ["schema", "enable", `${testPodName}/flexible`, schemaFile],
        {
          token: testToken,
        },
      );

      await cli.exec(["schema", "disable", `${testPodName}/flexible`], {
        token: testToken,
      });

      // Any data should now work
      const result = await cli.exec(
        ["write", testPodName, "flexible", "test-record", "any random content"],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);
    });
  });

  describe("schema help text", () => {
    it("should show help for schema command", async () => {
      const result = await cli.exec(["schema", "--help"], {});

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include("enable");
      expect(result.stdout).to.include("disable");
      expect(result.stdout).to.include("Manage stream validation schemas");
    });

    it("should show help for schema enable", async () => {
      const result = await cli.exec(["schema", "enable", "--help"], {});

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include("Enable schema validation");
      expect(result.stdout).to.include("--mode");
      expect(result.stdout).to.include("--applies-to");
    });

    it("should show help for schema disable", async () => {
      const result = await cli.exec(["schema", "disable", "--help"], {});

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include("Disable schema validation");
    });
  });
});
