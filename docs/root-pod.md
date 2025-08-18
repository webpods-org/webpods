# Root Pod Configuration

The root pod feature allows you to serve content on the main domain (e.g., `webpods.org`) instead of just on subdomains (e.g., `alice.webpods.org`).

## Configuration

Add the `rootPod` option to your `config.json`:

```json
{
  "rootPod": "root",
  // ... other config
}
```

This tells WebPods to serve content from the pod named "root" when requests come to the main domain.

## Usage

1. **Create the root pod** (manually, like any other pod):
   ```bash
   # Create the root pod as a user
   curl -X POST http://root.localhost:3000/pages/home \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: text/html" \
     -d "<h1>Welcome to WebPods</h1>"
   ```

2. **Configure links** for clean URLs:
   ```bash
   curl -X POST http://root.localhost:3000/.meta/links \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{
       "/": "pages/home",
       "/about": "pages/about",
       "/docs": "documentation/index"
     }'
   ```

3. **Access content** on the main domain:
   - `http://localhost:3000/` → serves content from `root` pod's `/` link
   - `http://localhost:3000/about` → serves content from `root` pod's `/about` link
   - `http://localhost:3000/pages/home` → directly serves the `home` record from `pages` stream

## Important Notes

- The root pod is **optional** - if not configured, the main domain returns 404 as before
- System endpoints (`/health`, `/auth/*`) always take precedence over root pod content
- The root pod is a **normal pod** with no special restrictions
- You must **manually create** the root pod - it's not auto-created
- All pod features work: streams, records, permissions, deletion, etc.

## Example: Landing Page

```bash
# 1. Create landing page content
curl -X POST http://root.localhost:3000/site/index \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: text/html" \
  -d @landing.html

# 2. Create API documentation
curl -X POST http://root.localhost:3000/docs/api \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: text/markdown" \
  -d @api-docs.md

# 3. Set up routing
curl -X POST http://root.localhost:3000/.meta/links \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "/": "site/index",
    "/api": "docs/api"
  }'

# 4. Update config.json
{
  "rootPod": "root",
  // ... rest of config
}

# 5. Restart server and access
# http://localhost:3000/ → shows landing page
# http://localhost:3000/api → shows API docs
```

## Security Considerations

- The root pod has the same permission model as any other pod
- Only the pod owner can modify content
- Streams can be public, private, or use custom permissions
- Consider making most root pod content public for a public-facing site