/**
 * CLI Authentication Commands Tests
 */

import { expect } from "chai";
import { CliTestHelper } from "../cli-test-helpers.js";
import {
  setupCliTests,
  cleanupCliTests,
  testToken,
  testUser,
} from "../test-setup.js";

describe("CLI Auth Commands", function () {
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

  describe("login command", () => {
    it("should display login instructions", async () => {
      const result = await cli.exec(["login"]);

      if (result.exitCode !== 0) {
        console.error("CLI failed with exit code:", result.exitCode);
        console.error("STDOUT:", result.stdout);
        console.error("STDERR:", result.stderr);
      }

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include("To authenticate with WebPods:");
      expect(result.stdout).to.include("Open this URL in your browser:");
      expect(result.stdout).to.include("http://localhost:3456/auth/");
    });

    it("should support custom provider", async () => {
      const result = await cli.exec(["login", "--provider", "google"]);

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include("/auth/google");
    });
  });

  describe("token set command", () => {
    it("should set authentication token", async () => {
      console.log("Test token:", testToken);
      console.log("Test user ID:", testUser.userId);
      console.log("Test server URL:", `http://localhost:3456`);
      const result = await cli.exec(["token", "set", testToken]);
      
      // Debug output
      if (result.exitCode !== 0) {
        console.log("Exit code:", result.exitCode);
        console.log("Stdout:", result.stdout);
        console.log("Stderr:", result.stderr);
      }

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include("Token set successfully");
    });
  });

  describe("whoami command", () => {
    it("should show user info when authenticated", async () => {
      const result = await cli.exec(["whoami", "--format", "json"], {
        token: testToken,
      });

      expect(result.exitCode).to.equal(0);
      const data = cli.parseJson(result.stdout);
      expect(data.user_id).to.equal(testUser.userId);
      expect(data.email).to.equal("cli-test@example.com");
    });

    it("should fail when not authenticated", async () => {
      const result = await cli.exec(["whoami", "--format", "json"]);

      expect(result.exitCode).to.not.equal(0);
      expect(result.stdout).to.include("Not authenticated");
    });
  });

  describe("token command", () => {
    it("should display current token", async () => {
      await cli.setToken(testToken);
      const result = await cli.exec(["token"]);

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include(testToken);
    });

    it("should show message when no token is set", async () => {
      await cli.clearToken();
      const result = await cli.exec(["token"]);

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include("No token stored");
    });
  });

  describe("logout command", () => {
    it("should clear stored token", async () => {
      await cli.setToken(testToken);
      const result = await cli.exec(["logout"]);

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include("Logged out successfully");

      // Verify token is cleared
      const tokenResult = await cli.exec(["token"]);
      expect(tokenResult.stdout).to.include("No token stored");
    });
  });
});
