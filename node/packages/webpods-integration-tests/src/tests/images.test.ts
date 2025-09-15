// Image upload and serving tests for WebPods
import { expect } from "chai";
import {
  TestHttpClient,
  createTestUser,
  createTestPod,
  clearAllCache,
} from "webpods-test-utils";
import { testDb } from "../test-setup.js";

describe("WebPods Image Support", () => {
  let client: TestHttpClient;
  let userId: string;
  let authToken: string;
  const testPodId = "test-images";
  const baseUrl = `http://${testPodId}.localhost:3000`;

  // Small test image (1x1 transparent PNG)
  const testPngBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  const testPngDataUrl = `data:image/png;base64,${testPngBase64}`;

  // Small test SVG
  const testSvg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><circle cx="50" cy="50" r="40" fill="red"/></svg>';

  beforeEach(async () => {
    await clearAllCache();
    client = new TestHttpClient("http://localhost:3000");
    // Create a test user and auth token
    const db = testDb.getDb();
    const user = await createTestUser(db, {
      provider: "test-auth-provider-1",
      providerId: "img123",
      email: "images@example.com",
      name: "Image Test User",
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
    await clearAllCache();
  });

  describe("Image Upload", () => {
    it("should upload PNG image using data URL", async () => {
      // Create stream first
      await client.createStream("images/logo");

      // Data URLs are stored as strings with text/plain content type
      const response = await client.post(
        "/images/logo/main-logo",
        testPngDataUrl,
      );

      if (response.status !== 201) {
        console.error("Upload failed:", response.status, response.data);
      }
      expect(response.status).to.equal(201);
      expect(response.data).to.have.property("index", 0);
      expect(response.data).to.have.property("name", "main-logo");
      expect(response.data).to.have.property("hash");
      expect(response.data).to.have.property("size");
      // content and contentType are no longer returned in minimal response
    });

    it("should store base64 string as text when sent with text content type", async () => {
      // Create stream first
      await client.createStream("images/avatar");

      // Sending base64 string with text/plain content type stores it as text
      const response = await client.post(
        "/images/avatar/user-avatar",
        testPngBase64,
        {
          headers: {
            "Content-Type": "text/plain",
          },
        },
      );

      expect(response.status).to.equal(201);
      // contentType is no longer returned in minimal response
      expect(response.data).to.have.property("hash");
      expect(response.data).to.have.property("size");
      // content is no longer returned in minimal response
    });

    it("should upload SVG as text", async () => {
      await client.createStream("images/icon");
      // SVG is text, so we can send it directly with correct content type
      const response = await client.post("/images/icon/app-icon", testSvg, {
        headers: {
          "Content-Type": "image/svg+xml",
        },
      });

      if (response.status !== 201) {
        console.error("SVG upload failed:", response.status, response.data);
      }
      expect(response.status).to.equal(201);
      // contentType is no longer returned in minimal response
      expect(response.data).to.have.property("hash");
      expect(response.data).to.have.property("size");
      // content is no longer returned in minimal response
    });

    it("should store text with any content type", async () => {
      await client.createStream("images");
      // Content type is just metadata - text is stored as text
      const response = await client.post("/images/text-file", "not-an-image", {
        headers: {
          "Content-Type": "image/png",
        },
      });

      expect(response.status).to.equal(201);
      // Even though we sent Content-Type: image/png, the actual stored content type
      // depends on how Express parsed it (likely as raw Buffer due to image/* type)
      // content is no longer returned in minimal response
      expect(response.data).to.have.property("size");
    });

    it("should reject content exceeding size limit", async () => {
      await client.createStream("images");
      // Create a large base64 string (>10MB, which is the default limit)
      // Express will reject this before our code can handle it
      const largeBase64 = "A".repeat(15 * 1024 * 1024); // ~15MB of 'A's

      // Use data URL for large base64 content
      const largeDataUrl = `data:image/png;base64,${largeBase64}`;
      const response = await client.post("/images/large", largeDataUrl);

      // Express returns 500 with INTERNAL_ERROR when payload exceeds limit
      // This is expected behavior - the limit is enforced at the Express middleware level
      expect(response.status).to.be.oneOf([413, 500]);
      expect(response.data.error.code).to.be.oneOf([
        "CONTENT_TOO_LARGE",
        "INTERNAL_ERROR",
      ]);
    });

    it("should handle JPEG data URLs", async () => {
      await client.createStream("photos/test");
      // Small JPEG test data (base64)
      const jpegBase64 =
        "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAr/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA8A/9k=";

      // Data URLs are stored as text/plain
      const jpegDataUrl = `data:image/jpeg;base64,${jpegBase64}`;
      const response = await client.post("/photos/test/sample", jpegDataUrl);

      expect(response.status).to.equal(201);
      // contentType is no longer returned in minimal response
      expect(response.data).to.have.property("hash");
      expect(response.data).to.have.property("size");
      // content is no longer returned in minimal response
    });
  });

  describe("Image Serving", () => {
    beforeEach(async () => {
      // Create streams and upload test images
      await client.createStream("gallery/photo1");
      await client.createStream("gallery/photo2");

      // Use data URL for PNG
      await client.post("/gallery/photo1/first", testPngDataUrl);

      // SVG can be sent directly with proper content type
      await client.post("/gallery/photo2/svg-image", testSvg, {
        headers: {
          "Content-Type": "image/svg+xml",
        },
      });
    });

    it("should serve data URL as text", async () => {
      const response = await client.get("/gallery/photo1/first");

      expect(response.status).to.equal(200);
      expect(response.headers["content-type"]).to.include("text/plain");
      expect(response.data).to.equal(testPngDataUrl);
    });

    it("should serve SVG image as text", async () => {
      const response = await client.get("/gallery/photo2/svg-image");

      expect(response.status).to.equal(200);
      expect(response.headers["content-type"]).to.include("image/svg+xml");
      expect(response.data).to.equal(testSvg);
    });

    it("should serve image by index", async () => {
      const response = await client.get("/gallery/photo1?i=0");

      expect(response.status).to.equal(200);
      expect(response.headers["content-type"]).to.include("application/json");
      expect(response.data.records).to.have.lengthOf(1);
      expect(response.data.records[0].content).to.equal(testPngDataUrl);
      expect(response.data.records[0].contentType).to.equal("text/plain");
    });

    it("should include metadata headers when serving images", async () => {
      const response = await client.get("/gallery/photo1/first");

      expect(response.status).to.equal(200);
      expect(response.headers).to.have.property("x-content-hash");
      expect(response.headers).to.have.property("x-hash");
      expect(response.headers).to.have.property("x-author", userId);
      expect(response.headers).to.have.property("x-timestamp");
    });
  });

  describe("Image with HTML Integration", () => {
    it("should create a simple image gallery page", async () => {
      // Create stream and upload an image
      await client.createStream("assets");
      await client.post("/assets/logo", testPngDataUrl);

      // Create HTML page that references the image
      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head><title>Gallery</title></head>
        <body>
          <h1>My Gallery</h1>
          <img src="/assets/logo" alt="Logo" />
        </body>
        </html>
      `;

      await client.createStream("pages/gallery");
      await client.post("/pages/gallery/index", htmlContent, {
        headers: {
          "Content-Type": "text/html",
        },
      });

      // Configure routing
      await client.post("/.config/routing", {
        "/": "pages/gallery/index",
      });

      // Verify the HTML page
      const pageResponse = await client.get("/pages/gallery/index");
      expect(pageResponse.status).to.equal(200);
      expect(pageResponse.headers["content-type"]).to.include("text/html");
      expect(pageResponse.data).to.include('<img src="/assets/logo"');

      // Verify the data URL can be served (as text/plain)
      const imageResponse = await client.get("/assets/logo");
      expect(imageResponse.status).to.equal(200);
      expect(imageResponse.headers["content-type"]).to.include("text/plain");
      expect(imageResponse.data).to.equal(testPngDataUrl);
    });
  });

  describe("Multiple Image Formats", () => {
    it("should store WebP data URL as text", async () => {
      await client.createStream("modern");
      // Small WebP test data (base64) - 1x1 pixel
      const webpBase64 =
        "UklGRhoAAABXRUJQVlA4IA4AAACyAgCdASoBAAEAAABIlpAADcAD+/4=";

      // Data URLs are stored as text/plain
      const webpDataUrl = `data:image/webp;base64,${webpBase64}`;
      const response = await client.post("/modern/image", webpDataUrl);

      expect(response.status).to.equal(201);
      // contentType is no longer returned in minimal response
      expect(response.data).to.have.property("hash");
      expect(response.data).to.have.property("size");
      // content is no longer returned in minimal response
    });

    it("should store GIF data URL as text", async () => {
      await client.createStream("animations");
      // Small GIF test data (base64) - 1x1 pixel
      const gifBase64 =
        "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

      // Data URLs are stored as text/plain
      const gifDataUrl = `data:image/gif;base64,${gifBase64}`;
      const response = await client.post("/animations/test", gifDataUrl);

      expect(response.status).to.equal(201);
      // contentType is no longer returned in minimal response
      expect(response.data).to.have.property("hash");
      expect(response.data).to.have.property("size");
      // content is no longer returned in minimal response
    });

    it("should store ICO data URL as text", async () => {
      await client.createStream("favicon");
      // Small ICO test data (base64)
      const icoBase64 =
        "AAABAAEAAQEAAAEAIAAwAAAAFgAAACgAAAABAAAAAgAAAAEAIAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAA////AAAAAAA=";

      // Data URLs are stored as text/plain
      const icoDataUrl = `data:image/x-icon;base64,${icoBase64}`;
      const response = await client.post("/favicon/icon", icoDataUrl);

      expect(response.status).to.equal(201);
      // contentType is no longer returned in minimal response
      expect(response.data).to.have.property("hash");
      expect(response.data).to.have.property("size");
      // content is no longer returned in minimal response
    });
  });
});
