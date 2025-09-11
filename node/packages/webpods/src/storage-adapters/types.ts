/**
 * Storage adapter function types
 *
 * Storage adapters are modules that export functions for storing and retrieving media files.
 * Each adapter can define its own storage format in the database's storage column.
 */

import type { Result } from "../utils/result.js";

/**
 * Store content externally
 * Returns the storage identifier to be saved in the database
 */
export type StoreFileFunction = (
  podName: string,
  streamPath: string,
  recordName: string,
  hash: string,
  content: Buffer,
  ext: string,
) => Promise<Result<string>>;

/**
 * Get the URL for redirecting to external content
 */
export type GetFileUrlFunction = (storageIdentifier: string) => string;

/**
 * Delete external content
 * @param purge - If true, delete both hash and name files. If false, only delete name file.
 */
export type DeleteFileFunction = (
  podName: string,
  streamPath: string,
  recordName: string,
  hash: string,
  ext: string,
  purge: boolean,
) => Promise<Result<void>>;

/**
 * Check if a file exists at the given path
 */
export type FileExistsFunction = (path: string) => Promise<boolean>;

/**
 * Storage adapter module interface
 */
export type StorageAdapter = {
  storeFile: StoreFileFunction;
  getFileUrl: GetFileUrlFunction;
  deleteFile: DeleteFileFunction;
  fileExists: FileExistsFunction;
};
