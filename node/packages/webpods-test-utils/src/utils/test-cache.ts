// Cache utilities for testing

/**
 * Clear all cache entries. Useful for ensuring test isolation.
 * Calls the test utility endpoint on the running test server.
 */
export async function clearAllCache(): Promise<void> {
  try {
    const response = await fetch(
      "http://localhost:3000/test-utils/clear-cache",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      },
    );

    if (!response.ok) {
      console.warn(
        "Failed to clear cache:",
        response.status,
        response.statusText,
      );
    }
  } catch (error) {
    // Silently fail if server is not running or endpoint doesn't exist
    // This allows tests to continue even if cache clearing fails
    console.warn("Could not clear cache:", error);
  }
}
