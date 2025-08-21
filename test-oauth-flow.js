// Using built-in fetch in Node.js 18+

async function testOAuthFlow() {
  const clientId = "webpods-test-client";
  const redirectUri = "http://localhost:3000/callback";
  const userId = "test-user-123";

  console.log("Starting OAuth flow...");

  // Start OAuth flow
  const authUrl = new URL("http://localhost:4444/oauth2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "openid offline pod:testpod");
  authUrl.searchParams.set("state", "test-state");

  console.log("1. Requesting:", authUrl.toString());

  const authResponse = await fetch(authUrl.toString(), {
    redirect: "manual",
  });

  const location = authResponse.headers.get("location");
  console.log("2. Hydra redirected to:", location);

  if (location) {
    // Follow redirect to login endpoint
    console.log("3. Following redirect with test headers...");
    const loginResponse = await fetch(location, {
      redirect: "manual",
      headers: {
        "x-test-user": userId,
        "x-test-consent": "true",
      },
    });

    console.log("4. Login response status:", loginResponse.status);
    console.log(
      "5. Login response location:",
      loginResponse.headers.get("location"),
    );

    if (loginResponse.status !== 302 && loginResponse.status !== 303) {
      const body = await loginResponse.text();
      console.log("Login response body:", body.substring(0, 500));
    }
  }
}

testOAuthFlow().catch(console.error);
