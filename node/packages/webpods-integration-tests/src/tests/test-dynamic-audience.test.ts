import { expect } from "chai";
import { TestHttpClient, createTestUser } from "webpods-test-utils";
import { testDb } from "../test-setup.js";
import crypto from "crypto";

describe("Dynamic Audience OAuth Test", () => {
  it("should work with pods parameter instead of pod:alice scope", async () => {
    // Create a test user
    const user = await createTestUser(testDb.getDb(), {
      provider: "test",
      email: "audience-test@example.com",
      name: "Audience Test User",
    });
    const userId = user.userId;

    // Start OAuth flow with pods parameter
    const clientId = "webpods-test-client";
    const redirectUri = "http://localhost:3000/callback";

    console.log("Testing new approach with pods in state parameter...");

    // Build auth URL with generic scopes and pods in state
    const authUrl = new URL("http://localhost:4444/oauth2/auth");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", "openid offline"); // Generic scopes only

    // Encode pods in state parameter since Hydra doesn't pass custom params through
    const stateData = {
      nonce: "test-nonce",
      pods: ["alice", "bob"],
    };
    const state = Buffer.from(JSON.stringify(stateData)).toString("base64");
    authUrl.searchParams.set("state", state);

    // Generate PKCE with S256
    const codeVerifier = "test-verifier-43-chars-minimum-required-length-xyz";
    const codeChallenge = crypto
      .createHash("sha256")
      .update(codeVerifier)
      .digest("base64url");
    authUrl.searchParams.set("code_challenge", codeChallenge);
    authUrl.searchParams.set("code_challenge_method", "S256");

    console.log("1. Requesting:", authUrl.toString());

    // Cookie jar to maintain session
    const cookies = new Map<string, string>();

    const parseCookies = (setCookieHeader: string | null) => {
      if (!setCookieHeader) return;
      const cookieArray = setCookieHeader.split(", ory_");
      cookieArray.forEach((cookie, index) => {
        if (index > 0) cookie = "ory_" + cookie;
        const firstPart = cookie.split(";")[0];
        if (!firstPart) return;
        const parts = firstPart.split("=");
        if (parts.length === 2 && parts[0] && parts[1]) {
          cookies.set(parts[0].trim(), parts[1].trim());
        }
      });
    };

    const getCookieHeader = () => {
      return Array.from(cookies.entries())
        .map(([name, value]) => `${name}=${value}`)
        .join("; ");
    };

    // Start OAuth flow
    const authResponse = await fetch(authUrl.toString(), {
      redirect: "manual",
    });

    parseCookies(authResponse.headers.get("set-cookie"));

    const location = authResponse.headers.get("location");
    console.log("2. Hydra redirected to:", location?.substring(0, 100) + "...");

    if (!location) {
      throw new Error("No redirect from Hydra");
    }

    // Follow to login endpoint with test headers and cookies
    const loginResponse = await fetch(location, {
      redirect: "manual",
      headers: {
        "x-test-user": userId,
        "x-test-consent": "true",
        Cookie: getCookieHeader(),
      },
    });

    parseCookies(loginResponse.headers.get("set-cookie"));
    console.log("3. Login response status:", loginResponse.status);

    // Follow redirects to get authorization code
    let nextLocation = loginResponse.headers.get("location");
    let redirectCount = 0;

    while (
      nextLocation &&
      !nextLocation.includes("code=") &&
      redirectCount < 10
    ) {
      const response = await fetch(nextLocation, {
        redirect: "manual",
        headers: {
          "x-test-user": userId,
          "x-test-consent": "true",
          Cookie: getCookieHeader(),
        },
      });

      parseCookies(response.headers.get("set-cookie"));
      nextLocation = response.headers.get("location");
      redirectCount++;

      if (nextLocation?.includes("error=")) {
        const errorUrl = new URL(nextLocation, "http://localhost:3000");
        const error = errorUrl.searchParams.get("error");
        const errorDesc = errorUrl.searchParams.get("error_description");
        console.error("OAuth error:", error, "-", errorDesc);
        throw new Error(`OAuth error: ${error}`);
      }
    }

    if (!nextLocation || !nextLocation.includes("code=")) {
      throw new Error("Failed to get authorization code");
    }

    console.log("4. Got authorization code!");

    // Extract code
    const callbackUrl = new URL(nextLocation, "http://localhost:3000");
    const code = callbackUrl.searchParams.get("code");

    // Exchange code for token
    const tokenResponse = await fetch("http://localhost:4444/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: code!,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: codeVerifier,
      }),
    });

    const tokenData = (await tokenResponse.json()) as any;
    console.log("5. Token response:", JSON.stringify(tokenData, null, 2));

    // Decode the access token to check audience
    if (tokenData.access_token) {
      const parts = tokenData.access_token.split(".");
      const payload = JSON.parse(Buffer.from(parts[1], "base64").toString());
      console.log("6. Token payload:", JSON.stringify(payload, null, 2));

      // Check if audience contains our pods
      expect(payload.aud).to.be.an("array");
      expect(payload.aud).to.include("https://alice.webpods.com");
      expect(payload.aud).to.include("https://bob.webpods.com");

      // Check if pods are in custom claims
      expect(payload.ext?.pods).to.be.an("array");
      expect(payload.ext?.pods).to.include("alice");
      expect(payload.ext?.pods).to.include("bob");

      console.log("SUCCESS! Token contains correct audience and pods!");
    } else {
      throw new Error("No access token received");
    }
  });
});
