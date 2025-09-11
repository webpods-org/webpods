/**
 * Stream sync command - sync local directory to stream
 */

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import mime from "mime-types";
import { createLogger, createCliOutput } from "../../logger.js";
import { getProfile, getCurrentProfile } from "../../config/profiles.js";
import { podRequest } from "../../http/index.js";
import { StreamListResponse } from "../../types.js";

const logger = createLogger("webpods:cli:sync");
const output = createCliOutput();

export interface SyncOptions {
  token?: string;
  server?: string;
  profile?: string;
  verbose?: boolean;
  dryRun?: boolean;
}

/**
 * Convert file path to record name (remove extension, handle special chars)
 */
function filePathToRecordName(filePath: string): string {
  // Remove extension and use the basename
  const basename = path.basename(filePath);
  const name = path.parse(basename).name;

  // Replace invalid characters with hyphens
  return name.replace(/[^a-zA-Z0-9._-]/g, "-");
}

/**
 * Detect content type from file extension
 */
function detectContentType(filePath: string): string {
  const mimeType = mime.lookup(filePath);
  return mimeType || "application/octet-stream";
}

/**
 * Calculate SHA-256 hash of file content
 */
async function calculateFileHash(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

/**
 * Recursively scan directory and get all files
 */
async function scanDirectory(
  dirPath: string,
  basePath: string = dirPath,
): Promise<
  Array<{
    filePath: string;
    relativePath: string;
    recordName: string;
    contentType: string;
    size: number;
    contentHash: string;
  }>
> {
  const files: Array<{
    filePath: string;
    relativePath: string;
    recordName: string;
    contentType: string;
    size: number;
    contentHash: string;
  }> = [];

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        // Recursively scan subdirectories
        const subFiles = await scanDirectory(fullPath, basePath);
        files.push(...subFiles);
      } else if (entry.isFile()) {
        // Skip hidden files
        if (entry.name.startsWith(".")) {
          continue;
        }

        const relativePath = path.relative(basePath, fullPath);
        const recordName = filePathToRecordName(entry.name);
        const contentType = detectContentType(fullPath);
        const stats = await fs.stat(fullPath);
        const contentHash = await calculateFileHash(fullPath);

        files.push({
          filePath: fullPath,
          relativePath,
          recordName,
          contentType,
          size: stats.size,
          contentHash,
        });
      }
    }
  } catch (error) {
    logger.error("Failed to scan directory", { error, dirPath });
    throw error;
  }

  return files;
}

/**
 * Get all records currently in the stream
 */
async function getStreamRecords(
  serverUrl: string,
  token: string,
  podName: string,
  streamPath: string,
): Promise<
  Array<{ name: string; path: string; size: number; contentHash: string }>
> {
  const requestPath = `/${streamPath}?recursive=true&limit=1000&unique=true`;

  try {
    const response = await podRequest<StreamListResponse>(
      podName,
      requestPath,
      {
        token,
        server: serverUrl,
      },
    );

    if (!response.success) {
      if (response.error.code === "NOT_FOUND") {
        // Stream doesn't exist yet, return empty array
        return [];
      }
      throw new Error(
        `Failed to get stream records: ${response.error.message}`,
      );
    }

    return response.data.records.map((record) => ({
      name: record.name,
      path: record.path,
      size: record.size,
      contentHash: record.contentHash,
    }));
  } catch (error) {
    logger.error("Failed to get stream records", {
      error,
      podName,
      streamPath,
    });
    throw error;
  }
}

/**
 * Upload file as a record
 */
async function uploadFile(
  serverUrl: string,
  token: string,
  podName: string,
  streamPath: string,
  file: {
    filePath: string;
    relativePath: string;
    recordName: string;
    contentType: string;
  },
): Promise<void> {
  try {
    const content = await fs.readFile(file.filePath, "utf8");

    const recordPath =
      streamPath === "/"
        ? `/${file.recordName}`
        : `${streamPath}/${file.recordName}`;

    const response = await podRequest(podName, recordPath, {
      method: "POST",
      token,
      server: serverUrl,
      headers: {
        "Content-Type": "text/plain",
        "X-Content-Type": file.contentType,
      },
      body: content,
    });

    if (!response.success) {
      throw new Error(
        `Failed to upload ${file.relativePath}: ${response.error.message}`,
      );
    }
  } catch (error) {
    logger.error("Failed to upload file", { error, file: file.relativePath });
    throw error;
  }
}

/**
 * Delete a record from the stream
 */
async function deleteRecord(
  serverUrl: string,
  token: string,
  podName: string,
  recordPath: string,
): Promise<void> {
  try {
    const response = await podRequest(podName, recordPath, {
      method: "DELETE",
      token,
      server: serverUrl,
    });

    if (!response.success && response.error.code !== "NOT_FOUND") {
      throw new Error(
        `Failed to delete ${recordPath}: ${response.error.message}`,
      );
    }
  } catch (error) {
    logger.error("Failed to delete record", { error, recordPath });
    throw error;
  }
}

/**
 * Sync local directory to stream
 */
export async function syncStream(
  podName: string,
  streamPath: string,
  localPath: string,
  options: SyncOptions = {},
): Promise<void> {
  try {
    // Get configuration
    const profile = options.profile
      ? await getProfile(options.profile)
      : await getCurrentProfile();
    const serverUrl: string =
      options.server || profile?.server || "http://localhost:3000";
    const token = options.token || profile?.token;

    if (!token) {
      output.error(
        'No authentication token found. Run "podctl login" first or use --token option.',
      );
      process.exit(1);
    }

    // Validate local path exists
    try {
      const stats = await fs.stat(localPath);
      if (!stats.isDirectory()) {
        output.error(`Local path is not a directory: ${localPath}`);
        process.exit(1);
      }
    } catch {
      output.error(`Local directory does not exist: ${localPath}`);
      process.exit(1);
    }

    output.info(
      `Syncing local directory "${localPath}" to stream "${streamPath}" in pod "${podName}"`,
    );

    // Scan local directory
    output.info("Scanning local directory...");
    const localFiles = await scanDirectory(localPath);

    if (options.verbose) {
      output.info(`Found ${localFiles.length} local files`);
    }

    // Get current stream records
    output.info("Fetching current stream records...");
    const streamRecords = await getStreamRecords(
      serverUrl,
      token!,
      podName,
      streamPath,
    );

    if (options.verbose) {
      output.info(`Found ${streamRecords.length} records in stream`);
    }

    // Create maps for easy lookup
    const localFileMap = new Map(localFiles.map((f) => [f.recordName, f]));
    const streamRecordMap = new Map(streamRecords.map((r) => [r.name, r]));

    // Determine operations needed
    const toUpload: typeof localFiles = [];
    const toDelete: string[] = [];

    // Check what needs to be uploaded (new or changed files)
    for (const localFile of localFiles) {
      const existingRecord = streamRecordMap.get(localFile.recordName);

      if (!existingRecord) {
        // New file
        toUpload.push(localFile);
      } else {
        // File exists, check if changed (content hash comparison)
        const remoteHash = existingRecord.contentHash.startsWith("sha256:")
          ? existingRecord.contentHash.slice(7)
          : existingRecord.contentHash;
        if (remoteHash !== localFile.contentHash) {
          toUpload.push(localFile);
        }
      }
    }

    // Check what needs to be deleted (records that don't exist locally)
    for (const [recordName, record] of streamRecordMap) {
      if (!localFileMap.has(recordName)) {
        toDelete.push(record.path);
      }
    }

    // Summary
    output.info(
      `Sync plan: ${toUpload.length} to upload, ${toDelete.length} to delete`,
    );

    if (options.dryRun) {
      if (toUpload.length > 0) {
        output.info("Files to upload:");
        toUpload.forEach((f) => output.info(`  + ${f.relativePath}`));
      }
      if (toDelete.length > 0) {
        output.info("Records to delete:");
        toDelete.forEach((path) => output.info(`  - ${path}`));
      }
      return;
    }

    // Execute uploads
    if (toUpload.length > 0) {
      output.info("Uploading files...");
      for (const file of toUpload) {
        if (options.verbose) {
          output.info(`Uploading: ${file.relativePath}`);
        }
        await uploadFile(serverUrl, token!, podName, streamPath, file);
      }
    }

    // Execute deletions
    if (toDelete.length > 0) {
      output.info("Deleting records...");
      for (const recordPath of toDelete) {
        if (options.verbose) {
          output.info(`Deleting: ${recordPath}`);
        }
        await deleteRecord(serverUrl, token!, podName, recordPath);
      }
    }

    output.success("Sync completed successfully!");
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    output.error(`Sync failed: ${errorMessage}`);
    if (options.verbose) {
      logger.error("Sync error details", { error });
    }
    process.exit(1);
  }
}
