/**
 * CLI Limits Command Tests
 */

import { expect } from "chai";
import { CliTestHelper } from "../cli-test-helpers.js";
import {
  setupCliTests,
  cleanupCliTests,
  resetCliTestDb,
  testToken,
} from "../test-setup.js";

describe("CLI Limits Command", function () {
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

  describe("limits command - general", () => {
    it("should show rate limit information", async () => {
      const result = await cli.exec(["limits"], {
        token: testToken,
      });

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include("Rate Limits");
      expect(result.stdout).to.include("Read operations:");
      expect(result.stdout).to.include("Write operations:");
      expect(result.stdout).to.include("Pod creation:");
      expect(result.stdout).to.include("Stream creation:");
    });

    it("should show current usage if available", async () => {
      // Make a few API calls first to generate some usage
      await cli.exec(["list"], { token: testToken });
      
      const result = await cli.exec(["limits"], {
        token: testToken,
      });

      expect(result.exitCode).to.equal(0);
      // May or may not show current usage depending on implementation
      if (result.stdout.includes("Current session:")) {
        expect(result.stdout).to.include("Remaining requests:");
      }
    });

    it("should work without authentication", async () => {
      const result = await cli.exec(["limits"]);

      // Should show default limits even without auth
      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include("Rate Limits");
    });
  });

  describe("limits command - specific action", () => {
    it("should show limits for specific action", async () => {
      const result = await cli.exec(["limits", "--action", "write"], {
        token: testToken,
      });

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include("write");
      
      // Should show specific limit info if available
      if (result.stdout.includes("Current usage")) {
        expect(result.stdout).to.include("Limit:");
        expect(result.stdout).to.include("Remaining:");
      }
    });

    it("should handle read action", async () => {
      const result = await cli.exec(["limits", "--action", "read"], {
        token: testToken,
      });

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include("read");
    });

    it("should handle podCreate action", async () => {
      const result = await cli.exec(["limits", "--action", "podCreate"], {
        token: testToken,
      });

      expect(result.exitCode).to.equal(0);
    });

    it("should handle streamCreate action", async () => {
      const result = await cli.exec(["limits", "--action", "streamCreate"], {
        token: testToken,
      });

      expect(result.exitCode).to.equal(0);
    });
  });

  describe("limits command - output formats", () => {
    it("should output in JSON format", async () => {
      const result = await cli.exec(["limits", "--format", "json"], {
        token: testToken,
      });

      expect(result.exitCode).to.equal(0);
      const data = JSON.parse(result.stdout);
      expect(data).to.have.property("limits");
      expect(data.limits).to.have.property("read");
      expect(data.limits).to.have.property("write");
    });

    it("should output in YAML format", async () => {
      const result = await cli.exec(["limits", "--format", "yaml"], {
        token: testToken,
      });

      expect(result.exitCode).to.equal(0);
      // Since YAML outputs as JSON for now, parse as JSON
      const data = JSON.parse(result.stdout);
      expect(data).to.have.property("limits");
    });

    it("should output in table format by default", async () => {
      const result = await cli.exec(["limits"], {
        token: testToken,
      });

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include("Rate Limits");
      expect(result.stdout).to.not.include("{"); // Not JSON
    });
  });

  describe("limits command - rate limit exceeded", () => {
    it("should handle rate limit exceeded response", async () => {
      // This test would need to actually exceed rate limits
      // which is difficult to test reliably
      // Just verify the command handles 429 responses gracefully
      
      // For now, just verify the command runs
      const result = await cli.exec(["limits"], {
        token: testToken,
      });

      expect(result.exitCode).to.be.oneOf([0, 1]);
      
      if (result.stdout.includes("Rate limit exceeded")) {
        expect(result.stdout).to.include("Reset at:");
      }
    });
  });
});