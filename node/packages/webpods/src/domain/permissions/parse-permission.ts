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

  // Handle stream-based permissions (e.g., "/members", "/.config/permissions")
  if (permission.startsWith("/")) {
    const streamPath = permission.substring(1); // Remove "/" prefix
    return { type: "stream", streamPath };
  }

  // Default to private for invalid permission strings
  return { type: "private" };
}
