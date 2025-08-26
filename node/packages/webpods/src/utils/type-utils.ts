/**
 * Type conversion utilities
 * Following Foreman's pattern for case conversion
 */

/**
 * Convert camelCase object to snake_case
 * Used when converting API input to database parameters
 */
export function toSnakeCase<T extends Record<string, any>>(
  obj: T,
): Record<string, any> {
  const result: Record<string, any> = {};

  for (const [key, value] of Object.entries(obj)) {
    const snakeKey = key.replace(
      /[A-Z]/g,
      (letter) => `_${letter.toLowerCase()}`,
    );
    result[snakeKey] = value;
  }

  return result;
}

/**
 * Convert snake_case object to camelCase
 * Used when converting database results to API output
 */
export function toCamelCase<T extends Record<string, any>>(
  obj: T,
): Record<string, any> {
  const result: Record<string, any> = {};

  for (const [key, value] of Object.entries(obj)) {
    const camelKey = key.replace(/_([a-z])/g, (_, letter) =>
      letter.toUpperCase(),
    );
    result[camelKey] = value;
  }

  return result;
}
