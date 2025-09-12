/**
 * Content type detection utilities
 */

/**
 * Determine if a content type should be parsed as binary data
 * Returns true for raw binary data, false for text-based data
 */
export function isBinaryContentType(contentType: string): boolean {
  if (!contentType) return false;

  const ct = contentType.toLowerCase().trim();

  // Text-based formats (even if they have misleading MIME types)
  if (
    ct.includes("xml") || // Any XML format (SVG, XHTML, RSS, etc.)
    ct.includes("json") || // JSON
    ct.includes("javascript") || // JavaScript
    ct.includes("ecmascript") || // ECMAScript
    ct.startsWith("text/") || // All text/* types
    ct === "application/x-www-form-urlencoded" ||
    ct.startsWith("application/x-yaml") || // YAML
    ct.startsWith("application/yaml")
  ) {
    // YAML alt
    return false;
  }

  // Known binary formats
  if (
    ct.startsWith("image/") || // Images (except SVG handled above)
    ct.startsWith("video/") || // Video
    ct.startsWith("audio/") || // Audio
    ct.startsWith("application/octet-stream") || // Generic binary
    ct.startsWith("application/pdf") || // PDF
    ct.startsWith("application/zip") || // Archives
    ct.startsWith("font/")
  ) {
    // Fonts
    return true;
  }

  // Special case for application/x- types
  // Most are binary, but some are text (handled above)
  if (ct.startsWith("application/x-")) {
    // Already handled text cases above (x-yaml, x-www-form-urlencoded)
    // Assume others are binary (x-tar, x-rar, x-7z-compressed, etc.)
    return true;
  }

  // When in doubt, treat as text (safer)
  // Text parsing won't corrupt data, but binary parsed as text would be
  return false;
}
