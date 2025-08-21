import { expect } from "chai";
import { TestHttpClient, createTestUser } from "webpods-test-utils";
import { testDb } from "../test-setup.js";
import crypto from "crypto";

describe("Debug OAuth Flow", () => {
  it("should debug the OAuth flow step by step", async () => {
    // Create a test user
    const user = await createTestUser(testDb.getDb(), {
      provider: "test",
      email: "debug-oauth@example.com",
      name: "Debug OAuth User",
    });
    const userId = user.userId;
    
    const clientId = "webpods-test-client";
    const redirectUri = "http://localhost:3000/callback";
    
    console.log("Starting OAuth flow debug...");
    
    // Cookie jar to maintain cookies across requests
    const cookies: Map<string, string> = new Map();
    
    // Helper to get cookie header
    const getCookieHeader = () => {
      return Array.from(cookies.entries())
        .map(([name, value]) => `${name}=${value}`)
        .join("; ");
    };
    
    // Helper to parse set-cookie headers
    const parseCookies = (setCookieHeaders: string | null) => {
      if (!setCookieHeaders) return;
      // Handle multiple set-cookie headers
      const cookieStrings = setCookieHeaders.split(", ");
      for (const cookieString of cookieStrings) {
        const [nameValue] = cookieString.split(";");
        const [name, value] = nameValue.split("=");
        if (name && value) {
          cookies.set(name.trim(), value.trim());
        }
      }
    };
    
    // Generate PKCE parameters using S256
    const codeVerifier = "test-verifier-43-chars-minimum-required-length-abcdefgh";
    const codeChallenge = crypto
      .createHash("sha256")
      .update(codeVerifier)
      .digest("base64url");
    
    // Start OAuth flow
    const authUrl = new URL("http://localhost:4444/oauth2/auth");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", "openid offline");
    authUrl.searchParams.set("state", "test-state");
    authUrl.searchParams.set("code_challenge", codeChallenge);
    authUrl.searchParams.set("code_challenge_method", "S256");
    
    console.log("1. Requesting:", authUrl.toString());
    
    const authResponse = await fetch(authUrl.toString(), {
      redirect: "manual",
    });
    
    parseCookies(authResponse.headers.get("set-cookie"));
    const location = authResponse.headers.get("location");
    console.log("2. Hydra redirected to:", location);
    console.log("   Cookies collected:", Array.from(cookies.keys()).join(", "));
    
    if (location) {
      // Follow redirect to login endpoint
      console.log("3. Following redirect with test headers and cookies...");
      const loginResponse = await fetch(location, {
        redirect: "manual",
        headers: {
          "x-test-user": userId,
          "x-test-consent": "true",
          "Cookie": getCookieHeader(),
        },
      });
      
      parseCookies(loginResponse.headers.get("set-cookie"));
      console.log("4. Login response status:", loginResponse.status);
      console.log("5. Login response location:", loginResponse.headers.get("location"));
      console.log("   Cookies now:", Array.from(cookies.keys()).join(", "));
      
      if (loginResponse.status !== 302 && loginResponse.status !== 303) {
        const body = await loginResponse.text();
        console.log("Login response body:", body.substring(0, 500));
      }
      
      // Follow more redirects if needed
      let nextLocation = loginResponse.headers.get("location");
      let redirectCount = 0;
      while (nextLocation && redirectCount < 10) {
        console.log(`Following redirect ${redirectCount + 1} to:`, nextLocation);
        const nextResponse = await fetch(nextLocation, {
          redirect: "manual",
          headers: {
            "x-test-user": userId,
            "x-test-consent": "true",
            "Cookie": getCookieHeader(),
          },
        });
        
        parseCookies(nextResponse.headers.get("set-cookie"));
        console.log(`Response status:`, nextResponse.status);
        nextLocation = nextResponse.headers.get("location");
        console.log(`Next location:`, nextLocation);
        console.log(`Cookies:`, Array.from(cookies.keys()).join(", "));
        
        if (nextLocation && nextLocation.includes("code=")) {
          console.log("Got authorization code!");
          
          // Extract the code
          const callbackUrl = new URL(nextLocation, "http://localhost:3000");
          const code = callbackUrl.searchParams.get("code");
          console.log("Authorization code:", code);
          
          if (code) {
            // Exchange code for token
            console.log("Exchanging code for token...");
            const tokenResponse = await fetch("http://localhost:4444/oauth2/token", {
              method: "POST",
              headers: {
                "Content-Type": "application/x-www-form-urlencoded",
              },
              body: new URLSearchParams({
                grant_type: "authorization_code",
                code,
                redirect_uri: redirectUri,
                client_id: clientId,
                code_verifier: codeVerifier,
              }),
            });
            
            console.log("Token response status:", tokenResponse.status);
            const tokenData = await tokenResponse.json();
            console.log("Token response:", JSON.stringify(tokenData, null, 2));
            
            if (tokenData.access_token) {
              console.log("SUCCESS! Got access token");
            }
          }
          break;
        }
        
        redirectCount++;
      }
    }
    
    // This test is just for debugging
    expect(true).to.be.true;
  });
});