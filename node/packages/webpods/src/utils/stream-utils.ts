/**
 * Utility functions for working with hierarchical streams
 */

/**
 * Parse a path into segments
 * @param path - Path like "/blog/posts/2024" or "blog/posts/2024"
 * @returns Array of path segments ["blog", "posts", "2024"]
 */
export function parseStreamPath(path: string): string[] {
  // Remove leading and trailing slashes, then split
  return path
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean);
}

/**
 * Join path segments into a full path
 * @param segments - Array of path segments
 * @returns Full path with leading slash
 */
export function joinStreamPath(segments: string[]): string {
  if (segments.length === 0) return "/";
  return "/" + segments.join("/");
}

/**
 * Build the full path for a stream by traversing up the parent chain
 * @param streamName - The stream's name
 * @param getParentPath - Function to get parent's path (async to allow DB lookups)
 * @returns Full path like "/blog/posts/2024"
 */
export async function buildStreamPath(
  streamName: string,
  getParentPath: () => Promise<string | null>,
): Promise<string> {
  const parentPath = await getParentPath();
  if (!parentPath || parentPath === "/") {
    return `/${streamName}`;
  }
  return `${parentPath}/${streamName}`;
}

/**
 * Validate a stream name (no slashes allowed)
 * @param name - Stream name to validate
 * @returns true if valid
 */
export function isValidStreamName(name: string): boolean {
  // Stream names cannot contain slashes and must be non-empty
  if (!name || name.includes("/")) {
    return false;
  }

  // Cannot start or end with periods
  if (name.startsWith(".") || name.endsWith(".")) {
    return false;
  }

  // Must match valid characters (alphanumeric, hyphens, underscores, periods)
  const validNameRegex = /^[a-zA-Z0-9._-]+$/;
  return validNameRegex.test(name);
}

/**
 * Validate a record name (no slashes allowed - like a filename)
 * @param name - Record name to validate
 * @returns true if valid
 */
export function isValidRecordName(name: string): boolean {
  // Record names cannot contain slashes and must be non-empty
  if (!name || name.includes("/")) {
    return false;
  }

  // Cannot start or end with periods
  if (name.startsWith(".") || name.endsWith(".")) {
    return false;
  }

  // Must match valid characters
  const validNameRegex = /^[a-zA-Z0-9._-]+$/;
  return validNameRegex.test(name);
}

/**
 * Get the parent path from a full path
 * @param path - Full path like "/blog/posts/2024"
 * @returns Parent path like "/blog/posts" or null if at root
 */
export function getParentPath(path: string): string | null {
  const segments = parseStreamPath(path);
  if (segments.length <= 1) {
    return null; // At root level
  }

  segments.pop(); // Remove last segment
  return joinStreamPath(segments);
}

/**
 * Get the stream name from a full path
 * @param path - Full path like "/blog/posts/2024"
 * @returns Stream name like "2024"
 */
export function getStreamNameFromPath(path: string): string {
  const segments = parseStreamPath(path);
  return segments[segments.length - 1] || "";
}
