// Cache utilities for testing

/**
 * Clear all cache entries. Useful for ensuring test isolation.
 * Calls the test utility endpoint on the running test server.
 * @param port - The port the test server is running on (default: 3000)
 */
export async function clearAllCache(port: number = 3000): Promise<void> {
  try {
    // Try the new endpoint first
    const response = await fetch(
      `http://localhost:${port}/test-utils/cache/clear`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      },
    );

    if (!response.ok) {
      // Fallback to old endpoint for backwards compatibility
      const fallbackResponse = await fetch(
        `http://localhost:${port}/test-utils/clear-cache`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        },
      );

      if (!fallbackResponse.ok) {
        console.warn(
          "Failed to clear cache:",
          response.status,
          response.statusText,
        );
      }
    }
  } catch (error) {
    // Silently fail if server is not running or endpoint doesn't exist
    // This allows tests to continue even if cache clearing fails
    console.warn("Could not clear cache:", error);
  }
}
