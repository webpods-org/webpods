/**
 * Test output utilities for consistent formatting across test suites
 */

/**
 * Log a message with specified indentation
 */
export function logIndented(message: string, spaces: number): void {
  console.log(`${' '.repeat(spaces)}${message}`);
}