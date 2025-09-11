/**
 * Stream download command - download stream records to local directory
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createLogger, createCliOutput } from "../../logger.js";
import { getProfile, getCurrentProfile } from "../../config/profiles.js";
import { podRequest } from "../../http/index.js";

const logger = createLogger("webpods:cli:download");
const output = createCliOutput();

export interface DownloadOptions {
  token?: string;
  server?: string;
  profile?: string;
  verbose?: boolean;
  overwrite?: boolean;
}

/**
 * Convert record name to file path (ensure valid filename)
 */
function recordNameToFileName(recordName: string): string {
  // Replace invalid filesystem characters
  // eslint-disable-next-line no-control-regex
  return recordName.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
}

/**
 * Ensure directory exists, creating parent directories as needed
 */
async function ensureDirectoryExists(dirPath: string): Promise<void> {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error) {
    logger.error("Failed to create directory", { error, dirPath });
    throw error;
  }
}

/**
 * Get all records from stream recursively
 */
async function getStreamRecords(
  serverUrl: string,
  token: string,
  podName: string,
  streamPath: string,
): Promise<
  Array<{ name: string; path: string; content: string; contentType: string }>
> {
  try {
    const response = await podRequest<{
      records: Array<{ name: string; path: string; contentType: string }>;
    }>(podName, `${streamPath}?recursive=true&limit=1000`, {
      method: "GET",
      token,
      server: serverUrl,
    });

    if (!response.success) {
      if (response.error.code === "NOT_FOUND") {
        throw new Error(`Stream not found: ${streamPath}`);
      }
      throw new Error(
        `Failed to get stream records: ${response.error.message}`,
      );
    }

    const records = response.data.records || [];

    // Fetch content for each record
    const recordsWithContent = [];
    for (const record of records) {
      const contentResponse = await podRequest<string>(podName, record.path, {
        method: "GET",
        token,
        server: serverUrl,
      });

      if (contentResponse.success) {
        recordsWithContent.push({
          name: record.name,
          path: record.path,
          content: contentResponse.data,
          contentType: record.contentType || "text/plain",
        });
      }
    }

    return recordsWithContent;
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
 * Write record content to file
 */
async function writeRecordToFile(
  filePath: string,
  content: string,
  overwrite: boolean,
): Promise<boolean> {
  try {
    // Check if file exists
    try {
      await fs.access(filePath);
      if (!overwrite) {
        return false; // Skip existing file
      }
    } catch {
      // File doesn't exist, proceed with writing
    }

    // Ensure parent directory exists
    const parentDir = path.dirname(filePath);
    await ensureDirectoryExists(parentDir);

    // Write file content
    await fs.writeFile(filePath, content, "utf8");
    return true;
  } catch (error) {
    logger.error("Failed to write file", { error, filePath });
    throw error;
  }
}

/**
 * Download stream records to local directory
 */
export async function downloadStream(
  podName: string,
  streamPath: string,
  localPath: string,
  options: DownloadOptions = {},
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

    // Validate and create local directory
    try {
      await ensureDirectoryExists(localPath);
    } catch {
      output.error(`Failed to create local directory: ${localPath}`);
      process.exit(1);
    }

    output.info(
      `Downloading stream "${streamPath}" from pod "${podName}" to "${localPath}"`,
    );

    // Get stream records
    output.info("Fetching stream records...");
    const streamRecords = await getStreamRecords(
      serverUrl,
      token!,
      podName,
      streamPath,
    );

    if (options.verbose) {
      output.info(`Found ${streamRecords.length} records to download`);
    }

    if (streamRecords.length === 0) {
      output.info("No records found in stream");
      return;
    }

    // Process each record
    let downloadedCount = 0;
    let skippedCount = 0;

    for (const record of streamRecords) {
      const fileName = recordNameToFileName(record.name);
      const filePath = path.join(localPath, fileName);

      if (options.verbose) {
        output.info(`Downloading: ${record.name} -> ${fileName}`);
      }

      // Ensure content is a string
      const contentString =
        typeof record.content === "string"
          ? record.content
          : JSON.stringify(record.content);

      const written = await writeRecordToFile(
        filePath,
        contentString,
        options.overwrite || false,
      );

      if (written) {
        downloadedCount++;
      } else {
        skippedCount++;
        if (options.verbose) {
          output.info(
            `Skipped existing file: ${fileName} (use --overwrite to replace)`,
          );
        }
      }
    }

    // Summary
    output.success(`Download completed! ${downloadedCount} files downloaded`);
    if (skippedCount > 0) {
      output.info(
        `${skippedCount} files skipped (already exist - use --overwrite to replace)`,
      );
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    output.error(`Download failed: ${errorMessage}`);
    if (options.verbose) {
      logger.error("Download error details", { error });
    }
    process.exit(1);
  }
}
