/**
 * Utility functions for stream name normalization
 */

/**
 * Ensures a stream name has a leading slash.
 * If the stream name already starts with '/', returns it unchanged.
 * Otherwise, prepends '/' to the stream name.
 *
 * @param streamName - The stream name to normalize
 * @returns The normalized stream name with a leading slash
 *
 * @example
 * normalizeStreamName('blog/posts') // Returns '/blog/posts'
 * normalizeStreamName('/blog/posts') // Returns '/blog/posts'
 * normalizeStreamName('') // Returns '/'
 */
export function normalizeStreamName(streamName: string): string {
  if (!streamName) {
    return "/";
  }
  return streamName.startsWith("/") ? streamName : `/${streamName}`;
}

/**
 * Removes leading slash from a stream name if present.
 * Used for backwards compatibility in places that expect no leading slash.
 *
 * @param streamName - The stream name to denormalize
 * @returns The stream name without a leading slash
 *
 * @example
 * denormalizeStreamName('/blog/posts') // Returns 'blog/posts'
 * denormalizeStreamName('blog/posts') // Returns 'blog/posts'
 * denormalizeStreamName('/') // Returns ''
 */
export function denormalizeStreamName(streamName: string): string {
  if (streamName === "/") {
    return "";
  }
  return streamName.startsWith("/") ? streamName.slice(1) : streamName;
}
