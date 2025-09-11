/**
 * Filesystem storage adapter
 *
 * Stores media files on the local filesystem with dual storage:
 * 1. Hash-based path: Permanent storage by content hash
 * 2. Name-based path: Overwritable storage by record name
 */

import { promises as fs } from "fs";
import { join } from "path";
import { randomBytes } from "crypto";
import type { Result } from "../utils/result.js";
import type {
  StoreFileFunction,
  GetFileUrlFunction,
  DeleteFileFunction,
  FileExistsFunction,
} from "./types.js";
import { getConfig } from "../config-loader.js";
import { createLogger } from "../logger.js";
import { createError } from "../utils/errors.js";

const logger = createLogger("webpods:storage:filesystem");

/**
 * Sanitize path components to prevent directory traversal
 */
function sanitizePath(path: string): string {
  // Remove any directory traversal attempts
  return path
    .split("/")
    .filter((segment) => segment && segment !== "." && segment !== "..")
    .join("/");
}

/**
 * Get filesystem configuration
 */
function getFilesystemConfig() {
  const config = getConfig();
  if (!config.media?.externalStorage?.filesystem) {
    throw new Error("Filesystem storage adapter is not configured");
  }
  return config.media.externalStorage.filesystem;
}

/**
 * Store content to filesystem
 * Creates both hash-based and name-based files
 */
export const storeFile: StoreFileFunction = async (
  podName: string,
  streamPath: string,
  recordName: string,
  hash: string,
  content: Buffer,
  ext: string,
): Promise<Result<string>> => {
  try {
    const config = getFilesystemConfig();
    const basePath = config.basePath;

    // Sanitize all path components
    const safePod = sanitizePath(podName);
    const safeStream = sanitizePath(streamPath);
    const safeName = sanitizePath(recordName);
    const safeHash = sanitizePath(hash);

    // Ensure extension is safe (if provided)
    const safeExt = ext ? ext.replace(/[^a-zA-Z0-9]/g, "") : "";

    // Create paths - hash file is always just the hash, name file may have extension
    const hashDir = join(basePath, safePod, safeStream, ".storage");
    const hashPath = join(hashDir, safeHash);

    const nameDir = join(basePath, safePod, safeStream);
    const namePath = join(
      nameDir,
      safeExt ? `${safeName}.${safeExt}` : safeName,
    );

    // Create directories if they don't exist
    await fs.mkdir(hashDir, { recursive: true });
    await fs.mkdir(nameDir, { recursive: true });

    // Write to temporary file first (atomic write)
    const tempPath = join(hashDir, `.tmp_${randomBytes(16).toString("hex")}`);

    try {
      // Write to temp file
      await fs.writeFile(tempPath, content);

      // Move to hash-based location (permanent)
      await fs.rename(tempPath, hashPath);

      // Copy to name-based location (overwritable)
      await fs.writeFile(namePath, content);

      // Return storage identifier
      // Format: relative path from basePath that can be used to reconstruct URLs
      const storageId = join(safePod, safeStream, `${safeName}.${safeExt}`);

      logger.debug(`Stored file: hash=${hashPath}, name=${namePath}`);

      return { success: true, data: storageId };
    } catch (error) {
      // Clean up temp file if it exists
      try {
        await fs.unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }
      throw error;
    }
  } catch (error) {
    logger.error("Failed to store file", error as Record<string, unknown>);
    return {
      success: false,
      error: createError(
        "STORAGE_ERROR",
        `Failed to store file: ${error instanceof Error ? error.message : "Unknown error"}`,
      ),
    };
  }
};

/**
 * Get URL for external content
 * The storageIdentifier is the path we stored (e.g., "my-pod/images/profile.jpg")
 */
export const getFileUrl: GetFileUrlFunction = (
  storageIdentifier: string,
): string => {
  const config = getFilesystemConfig();
  const baseUrl = config.baseUrl;

  // Ensure baseUrl doesn't end with slash and path doesn't start with slash
  const cleanBaseUrl = baseUrl.replace(/\/$/, "");
  const cleanPath = storageIdentifier.replace(/^\//, "");

  return `${cleanBaseUrl}/${cleanPath}`;
};

/**
 * Delete external content
 * @param purge - If true, delete both hash and name files. If false, only delete name file.
 */
export const deleteFile: DeleteFileFunction = async (
  podName: string,
  streamPath: string,
  recordName: string,
  hash: string,
  ext: string,
  purge: boolean,
): Promise<Result<void>> => {
  try {
    const config = getFilesystemConfig();
    const basePath = config.basePath;

    // Sanitize path components
    const safePod = sanitizePath(podName);
    const safeStream = sanitizePath(streamPath);
    const safeName = sanitizePath(recordName);
    const safeHash = sanitizePath(hash);
    const safeExt = ext ? ext.replace(/[^a-zA-Z0-9]/g, "") : "";

    // Create paths - hash file is always just the hash, name file may have extension
    const hashPath = join(basePath, safePod, safeStream, ".storage", safeHash);
    const namePath = join(
      basePath,
      safePod,
      safeStream,
      safeExt ? `${safeName}.${safeExt}` : safeName,
    );

    // Always delete the name-based file
    const deletePromises = [
      fs.unlink(namePath).catch(() => {}), // Ignore if doesn't exist
    ];

    // Only delete hash file if purging
    if (purge) {
      deletePromises.push(
        fs.unlink(hashPath).catch(() => {}), // Ignore if doesn't exist
      );
      logger.debug(`Purging files: hash=${hashPath}, name=${namePath}`);
    } else {
      logger.debug(
        `Soft deleting file: name=${namePath} (keeping hash=${hashPath})`,
      );
    }

    await Promise.all(deletePromises);

    return { success: true, data: undefined };
  } catch (error) {
    logger.error("Failed to delete file", error as Record<string, unknown>);
    return {
      success: false,
      error: createError(
        "STORAGE_ERROR",
        `Failed to delete file: ${error instanceof Error ? error.message : "Unknown error"}`,
      ),
    };
  }
};

/**
 * Check if file exists
 */
export const fileExists: FileExistsFunction = async (
  path: string,
): Promise<boolean> => {
  try {
    const config = getFilesystemConfig();
    const fullPath = join(config.basePath, sanitizePath(path));
    await fs.access(fullPath);
    return true;
  } catch {
    return false;
  }
};
