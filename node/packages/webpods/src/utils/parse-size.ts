/**
 * Parse size strings like "1mb", "10kb", "1.5gb" to bytes
 */

export function parseSize(size: string): number {
  if (size === "0") {
    return 0;
  }

  const match = size
    .toLowerCase()
    .match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|tb)?$/);
  if (!match) {
    throw new Error(`Invalid size format: ${size}`);
  }

  const value = parseFloat(match[1] ?? "0");
  const unit = match[2] || "b";

  const multipliers: Record<string, number> = {
    b: 1,
    kb: 1024,
    mb: 1024 * 1024,
    gb: 1024 * 1024 * 1024,
    tb: 1024 * 1024 * 1024 * 1024,
  };

  const multiplier = multipliers[unit];
  if (multiplier === undefined) {
    throw new Error(`Invalid size unit: ${unit}`);
  }

  return Math.floor(value * multiplier);
}
