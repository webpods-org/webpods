/**
 * Version endpoint test
 */

import { expect } from "chai";
import { TestHttpClient, createTestUser } from "webpods-test-utils";

describe("Version", () => {
  let client: TestHttpClient;

  beforeEach(() => {
    client = new TestHttpClient("http://localhost:3099");
  });

  it("should return correct version in health endpoint", async () => {
    const response = await client.get("/health");

    expect(response.status).to.equal(200);
    expect(response.data).to.have.property("version");
    // Version should match semver format (e.g., 0.0.10)
    expect(response.data.version).to.match(/^\d+\.\d+\.\d+$/);
    // Should not be the old hardcoded version
    expect(response.data.version).to.not.equal("0.0.3");
  });
});
