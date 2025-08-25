/**
 * Parse a permission string into its component parts
 */

export function parsePermission(permission: string): {
  type: "public" | "private" | "stream";
  streamPath?: string;
} {
  if (permission === "public") {
    return { type: "public" };
  }

  if (permission === "private") {
    return { type: "private" };
  }

  // Handle stream-based permissions (e.g., "stream:.meta/permissions")
  if (permission.startsWith("stream:")) {
    const streamPath = permission.slice(7); // Remove "stream:" prefix
    return { type: "stream", streamPath };
  }

  // Default to private for invalid permission strings
  return { type: "private" };
}