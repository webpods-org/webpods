/**
 * Storage adapter selector
 *
 * Returns the appropriate storage adapter functions based on configuration
 */

import type { StorageAdapter } from "./types.js";
import * as filesystem from "./filesystem.js";
import { getConfig } from "../config-loader.js";
import { parseSize } from "../utils/parse-size.js";

/**
 * Get the configured storage adapter
 */
export function getStorageAdapter(): StorageAdapter | null {
  const config = getConfig();

  // Check if external storage is enabled
  if (!config.media?.externalStorage?.enabled) {
    return null;
  }

  const adapterType = config.media.externalStorage.adapter;

  switch (adapterType) {
    case "filesystem":
      return filesystem;

    // Future adapters can be added here
    // case "s3":
    //   return s3Adapter;

    default:
      throw new Error(`Unknown storage adapter type: ${adapterType}`);
  }
}

/**
 * Check if external storage is enabled and configured
 */
export function isExternalStorageEnabled(): boolean {
  const config = getConfig();
  return config.media?.externalStorage?.enabled === true;
}

/**
 * Get the minimum size for external storage in bytes
 */
export function getMinExternalSize(): number {
  const config = getConfig();
  const minSize = config.media?.externalStorage?.minSize;

  if (!minSize) {
    return Infinity; // Effectively disabled if not configured
  }

  return parseSize(minSize);
}

// Re-export types for convenience
export type {
  StorageAdapter,
  StoreFileFunction,
  GetFileUrlFunction,
  DeleteFileFunction,
  FileExistsFunction,
} from "./types.js";
