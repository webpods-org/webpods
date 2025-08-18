# Image Support

WebPods now supports serving images and other binary content using base64 encoding.

## Supported Image Formats

- PNG (`image/png`)
- JPEG (`image/jpeg`, `image/jpg`)
- GIF (`image/gif`)
- WebP (`image/webp`)
- SVG (`image/svg+xml`)
- ICO/Favicon (`image/x-icon`, `image/ico`)

## Uploading Images

### Method 1: Base64 Encoded String

Upload an image as a base64 encoded string:

```bash
# Convert image to base64
IMAGE_BASE64=$(base64 -w 0 < image.png)

# Upload to WebPods
curl -X POST alice.webpods.org/images/logo?alias=main \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Content-Type: image/png" \
  -d "$IMAGE_BASE64"
```

### Method 2: Data URL

Upload using a data URL that includes the MIME type:

```bash
# Create data URL
DATA_URL="data:image/png;base64,$(base64 -w 0 < image.png)"

# Upload to WebPods
curl -X POST alice.webpods.org/images/avatar \
  -H "Authorization: Bearer $TOKEN" \
  -d "$DATA_URL"
```

## Serving Images

Images are automatically decoded from base64 and served with the correct content type:

```bash
# Get image by alias
curl alice.webpods.org/images/logo/main

# Get latest image
curl alice.webpods.org/images/avatar?i=-1

# Get by index
curl alice.webpods.org/images/gallery?i=0
```

## Building an Image Gallery

Create a complete image gallery with HTML:

```bash
# Upload images
curl -X POST alice.webpods.org/photos/sunset \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Content-Type: image/jpeg" \
  -d "$SUNSET_BASE64"

curl -X POST alice.webpods.org/photos/mountain \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Content-Type: image/jpeg" \
  -d "$MOUNTAIN_BASE64"

# Create gallery HTML
curl -X POST alice.webpods.org/pages/gallery?alias=index \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Content-Type: text/html" \
  -d '<html>
<head><title>My Gallery</title></head>
<body>
  <h1>Photo Gallery</h1>
  <img src="/photos/sunset?i=-1" alt="Sunset" style="max-width: 500px;">
  <img src="/photos/mountain?i=-1" alt="Mountain" style="max-width: 500px;">
</body>
</html>'

# Set up routing
curl -X POST alice.webpods.org/.meta/links \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"/":" pages/gallery/index"}'

# Now visit alice.webpods.org to see your gallery!
```

## SVG Support

SVG images are stored as text and don't require base64 encoding:

```bash
curl -X POST alice.webpods.org/icons/logo \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Content-Type: image/svg+xml" \
  -d '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
    <circle cx="50" cy="50" r="40" fill="blue"/>
  </svg>'
```

## Size Limits

- Configurable via `MAX_PAYLOAD_SIZE` environment variable or `server.maxPayloadSize` in config.json
- Default: **10mb**
- Applies to ALL content types (text, JSON, images, etc.)
- Base64 encoding adds ~33% overhead for binary content

### Configuration Examples

```bash
# Environment variable
export MAX_PAYLOAD_SIZE=50mb

# Or in config.json
{
  "server": {
    "maxPayloadSize": "50mb"
  }
}
```

Supported units: `kb`, `mb`, `gb` (e.g., "512kb", "50mb", "1gb")

## Technical Details

### Storage
Images are stored as base64-encoded strings in the existing TEXT column of the database. This approach:
- Maintains backward compatibility
- Avoids database schema changes
- Simplifies the implementation

### Content Detection
The system automatically detects image content:
1. Checks for data URLs (`data:image/png;base64,...`)
2. Uses `X-Content-Type` header (highest priority)
3. Falls back to `Content-Type` header
4. Defaults to `text/plain` if not specified

### Performance Considerations
- Base64 encoding increases storage size by ~33%
- Decoding happens on-the-fly when serving images
- Consider using external CDN for high-traffic images
- SVG images don't require base64 encoding

## Examples

### Favicon
```bash
# Upload favicon
curl -X POST alice.webpods.org/favicon.ico \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Content-Type: image/x-icon" \
  -d "$FAVICON_BASE64"

# Reference in HTML
<link rel="icon" href="/favicon.ico?i=-1">
```

### Profile Avatar System
```bash
# Upload user avatar
curl -X POST alice.webpods.org/users/john/avatar \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Content-Type: image/jpeg" \
  -d "$AVATAR_BASE64"

# Serve avatar
<img src="/users/john/avatar?i=-1" alt="John's Avatar">
```

### Logo with Versions
```bash
# Upload multiple versions
curl -X POST alice.webpods.org/brand/logo?alias=v1 \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Content-Type: image/png" \
  -d "$LOGO_V1"

curl -X POST alice.webpods.org/brand/logo?alias=v2 \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Content-Type: image/png" \
  -d "$LOGO_V2"

# Access specific versions
/brand/logo/v1  # First version
/brand/logo/v2  # Second version
/brand/logo?i=-1  # Latest version
```