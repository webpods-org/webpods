/**
 * Record operations (read, write, list, delete)
 */

import { promises as fs } from "fs";
import { podRequest } from "../../http/index.js";
import { StreamRecord, StreamListResponse } from "../../types.js";
import { createLogger, createCliOutput } from "../../logger.js";

const logger = createLogger("webpods:cli:records");

/**
 * Write data to a stream record
 */
export async function write(options: {
  quiet?: boolean;
  pod?: string;
  stream?: string;
  name?: string;
  data?: string;
  file?: string;
  permission?: string;
  header?: string | string[];
  token?: string;
  server?: string;
  profile?: string;
  [key: string]: unknown;
}): Promise<void> {
  const output = createCliOutput(options.quiet);

  try {
    logger.debug("Writing record", {
      pod: options.pod,
      stream: options.stream,
      name: options.name,
    });

    if (!options.pod || !options.stream || !options.name) {
      output.error("Pod, stream, and name are required for writing records.");
      process.exit(1);
    }

    let content: string;
    let contentType = "text/plain";

    // Get content from various sources
    if (options.file) {
      try {
        logger.debug("Reading content from file", { file: options.file });
        content = await fs.readFile(options.file, "utf-8");
        // Try to determine content type from extension
        if (options.file.endsWith(".json")) {
          contentType = "application/json";
        } else if (options.file.endsWith(".html")) {
          contentType = "text/html";
        } else if (options.file.endsWith(".css")) {
          contentType = "text/css";
        } else if (options.file.endsWith(".js")) {
          contentType = "application/javascript";
        }
      } catch (error) {
        output.error(
          `Error reading file '${options.file}': ${(error as Error).message}`,
        );
        logger.error("File read failed", {
          file: options.file,
          error: (error as Error).message,
        });
        process.exit(1);
      }
    } else if (options.data === "-") {
      // Read from stdin
      logger.debug("Reading content from stdin");
      const chunks = [];
      for await (const chunk of process.stdin) {
        chunks.push(chunk);
      }
      content = Buffer.concat(chunks).toString("utf-8");
    } else if (options.data) {
      content = options.data;
      logger.debug("Using provided data", { contentLength: content.length });
      // Try to detect if it's JSON
      try {
        JSON.parse(content);
        contentType = "application/json";
      } catch {
        // Not JSON, keep as text/plain
      }
    } else {
      output.error("No data provided. Use [data], --file, or - for stdin.");
      logger.error("No data provided for write operation");
      process.exit(1);
    }

    logger.debug("Content prepared", {
      contentType,
      contentLength: content.length,
    });

    // Construct URL with permission query param if provided
    let path = `/${options.stream}/${options.name}`;
    if (options.permission) {
      path += `?access=${encodeURIComponent(options.permission)}`;
    }

    // Parse custom headers
    const headers: Record<string, string> = {
      "Content-Type": contentType,
    };

    if (options.header) {
      const headerArray = Array.isArray(options.header)
        ? options.header
        : [options.header];

      for (const header of headerArray) {
        const colonIndex = header.indexOf(":");
        if (colonIndex > 0) {
          const key = header.substring(0, colonIndex).trim();
          const value = header.substring(colonIndex + 1).trim();
          // Add x-record-header- prefix for custom headers
          headers[`x-record-header-${key}`] = value;
        } else {
          output.warning(
            `Invalid header format: ${header}. Use 'key:value' format.`,
          );
        }
      }
    }

    const result = await podRequest<StreamRecord>(options.pod, path, {
      method: "POST",
      headers,
      body: content,
      token: options.token,
      server: options.server,
    });

    if (!result.success) {
      const errorMessage =
        result.error.message || result.error.code || "Failed to write record";
      output.error("Error: " + errorMessage);
      logger.error("Record write failed", {
        pod: options.pod,
        stream: options.stream,
        name: options.name,
        error: result.error,
      });
      process.exit(1);
    }

    output.success(
      `Written to ${options.pod}/${options.stream}/${options.name}`,
    );
    output.print(`Index: ${result.data.index}`);
    output.print(`Hash: ${result.data.hash}`);

    if (options.permission) {
      output.print(`Permission: ${options.permission}`);
    }

    logger.info("Record written successfully", {
      pod: options.pod,
      stream: options.stream,
      name: options.name,
      index: result.data.index,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Write command failed", {
      pod: options.pod,
      stream: options.stream,
      name: options.name,
      error: errorMessage,
    });
    output.error("Error: " + errorMessage);
    process.exit(1);
  }
}

/**
 * Read data from a stream record
 */
export async function read(options: {
  quiet?: boolean;
  pod?: string;
  stream?: string;
  name?: string;
  index?: string;
  output?: string;
  token?: string;
  server?: string;
  profile?: string;
  [key: string]: unknown;
}): Promise<void> {
  const output = createCliOutput(options.quiet);

  try {
    logger.debug("Reading record", {
      pod: options.pod,
      stream: options.stream,
      name: options.name,
      index: options.index,
    });

    if (!options.pod || !options.stream) {
      output.error("Pod and stream are required for reading records.");
      process.exit(1);
    }

    let path: string;

    if (options.index) {
      // Handle index parameter (could be single index, negative, or range)
      if (options.index.includes(":")) {
        // Range query
        path = `/${options.stream}?i=${encodeURIComponent(options.index)}`;
        logger.debug("Using index range query", { index: options.index });
      } else {
        // Single index
        path = `/${options.stream}?i=${encodeURIComponent(options.index)}`;
        logger.debug("Using single index query", { index: options.index });
      }
    } else if (options.name) {
      path = `/${options.stream}/${options.name}`;
      logger.debug("Using name query", { name: options.name });
    } else {
      output.error("Specify either --index or provide a record name.");
      logger.error("No index or name specified for read operation");
      process.exit(1);
    }

    const result = await podRequest<string | StreamRecord | StreamRecord[]>(
      options.pod,
      path,
      {
        token: options.token,
        server: options.server,
      },
    );

    if (!result.success) {
      if (result.error.code === "RECORD_NOT_FOUND") {
        output.error("Record not found.");
        logger.warn("Record not found", {
          pod: options.pod,
          stream: options.stream,
          path,
        });
      } else {
        output.error("Error: " + result.error.message);
        logger.error("Record read failed", {
          pod: options.pod,
          stream: options.stream,
          path,
          error: result.error,
        });
      }
      process.exit(1);
    }

    const content = result.data;
    logger.debug("Record retrieved", {
      contentType: typeof content,
      isArray: Array.isArray(content),
    });

    if (options.output) {
      // Save to file
      logger.debug("Saving to file", { output: options.output });
      let outputContent: string;
      if (typeof content === "string") {
        outputContent = content;
      } else if (Array.isArray(content)) {
        outputContent = JSON.stringify(content, null, 2);
      } else {
        outputContent =
          typeof content === "object"
            ? JSON.stringify(content, null, 2)
            : String(content);
      }

      try {
        await fs.writeFile(options.output, outputContent);
        output.success(`Saved to ${options.output}`);
        logger.info("Record saved to file", { output: options.output });
      } catch (error) {
        output.error(`Error saving file: ${(error as Error).message}`);
        logger.error("File save failed", {
          output: options.output,
          error: (error as Error).message,
        });
        process.exit(1);
      }
    } else {
      // Print to console
      if (typeof content === "string") {
        output.print(content);
      } else {
        output.print(JSON.stringify(content, null, 2));
      }
      logger.info("Record displayed", {
        pod: options.pod,
        stream: options.stream,
      });
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Read command failed", {
      pod: options.pod,
      stream: options.stream,
      error: errorMessage,
    });
    output.error("Error: " + errorMessage);
    process.exit(1);
  }
}

/**
 * List records in a stream
 */
export async function list(options: {
  quiet?: boolean;
  pod?: string;
  stream?: string;
  limit?: number;
  after?: number;
  unique?: boolean;
  recursive?: boolean;
  fields?: string;
  maxContentSize?: number;
  token?: string;
  server?: string;
  profile?: string;
  format?: string;
  [key: string]: unknown;
}): Promise<void> {
  const output = createCliOutput(options.quiet);

  try {
    logger.debug("Listing records", {
      pod: options.pod,
      stream: options.stream,
      limit: options.limit,
      after: options.after,
      unique: options.unique,
      recursive: options.recursive,
      fields: options.fields,
      maxContentSize: options.maxContentSize,
    });

    if (!options.pod || !options.stream) {
      output.error("Pod and stream are required for listing records.");
      process.exit(1);
    }

    // Check for incompatible options
    let path = `/${options.stream}`;
    const params = new URLSearchParams();

    if (options.limit) {
      params.set("limit", String(options.limit));
    }

    if (options.after !== undefined) {
      params.set("after", String(options.after));
    }

    if (options.unique) {
      params.set("unique", "true");
    }

    if (options.recursive) {
      params.set("recursive", "true");
    }

    if (options.fields) {
      params.set("fields", options.fields);
    }

    if (options.maxContentSize !== undefined) {
      params.set("maxContentSize", String(options.maxContentSize));
    }

    if (params.toString()) {
      path += `?${params.toString()}`;
    }

    logger.debug("Constructed request path", { path });

    const result = await podRequest<StreamListResponse>(options.pod, path, {
      token: options.token,
      server: options.server,
    });

    if (!result.success) {
      output.error("Error: " + result.error.message);
      logger.error("Record list failed", {
        pod: options.pod,
        stream: options.stream,
        error: result.error,
      });
      process.exit(1);
    }

    const response = result.data;
    const format = options.format || "table";
    logger.debug("Retrieved records", {
      count: response.records.length,
      total: response.total,
      format,
    });

    if (response.records.length === 0) {
      if (format === "json") {
        output.print(JSON.stringify(response, null, 2));
      } else {
        output.print("No records found in this stream.");
      }
      return;
    }

    switch (format) {
      case "json":
        output.print(JSON.stringify(response, null, 2));
        break;
      case "yaml":
        response.records.forEach((record, index) => {
          if (index > 0) output.print("---");
          output.print(`index: ${record.index}`);
          output.print(`name: ${record.name || ""}`);
          output.print(`content_type: ${record.content_type || "text/plain"}`);
          output.print(`hash: ${record.hash || ""}`);
          output.print(`timestamp: ${record.timestamp || ""}`);
          output.print(`userId: ${record.userId || ""}`);
        });
        break;
      case "csv":
        output.print("index,name,content_type,hash,timestamp,userId");
        response.records.forEach((record) => {
          output.print(
            `${record.index},"${record.name || ""}","${record.content_type || "text/plain"}","${record.hash || ""}","${record.timestamp || ""}","${record.userId || ""}"`,
          );
        });
        break;
      default: // table
        output.print(`Records in ${options.pod}/${options.stream}:`);
        output.print("─".repeat(60));
        response.records.forEach((record) => {
          let contentPreview = "";
          if (record.content !== undefined) {
            contentPreview =
              typeof record.content === "string"
                ? record.content.slice(0, 30) +
                  (record.content.length > 30 ? "..." : "")
                : JSON.stringify(record.content).slice(0, 30) + "...";
          }

          output.print(
            `[${record.index.toString().padStart(3)}] ${(record.name || "").padEnd(20)} ${(record.content_type || "text/plain").padEnd(15)} ${contentPreview}`,
          );
        });
        output.print("─".repeat(60));
        output.print(
          `Total: ${response.total} record${response.total === 1 ? "" : "s"}`,
        );
        if (response.has_more) {
          output.print(
            `More records available. Use --after ${response.records[response.records.length - 1].index} to continue.`,
          );
        }
    }

    logger.info("Records listed successfully", {
      pod: options.pod,
      stream: options.stream,
      count: response.records.length,
      format,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("List command failed", {
      pod: options.pod,
      stream: options.stream,
      error: errorMessage,
    });
    output.error("Error: " + errorMessage);
    process.exit(1);
  }
}

/**
 * Delete (soft delete) a record by writing a tombstone
 */
export async function deleteRecord(options: {
  quiet?: boolean;
  pod?: string;
  stream?: string;
  name?: string;
  hard?: boolean;
  token?: string;
  server?: string;
  profile?: string;
  [key: string]: unknown;
}): Promise<void> {
  const output = createCliOutput(options.quiet);

  try {
    logger.debug("Deleting record", {
      pod: options.pod,
      stream: options.stream,
      name: options.name,
      hard: options.hard,
    });

    if (!options.pod || !options.stream || !options.name) {
      output.error("Pod, stream, and name are required for deleting records.");
      process.exit(1);
    }

    if (options.hard) {
      // Hard delete (purge) - use DELETE method
      const path = `/${options.stream}/${options.name}`;
      const result = await podRequest(options.pod, path, {
        method: "DELETE",
        token: options.token,
        server: options.server,
        profile: options.profile,
      });

      logger.debug("Delete response", {
        success: result.success,
        error: result.success ? null : result.error,
      });

      if (result.success) {
        output.success(
          `Record '${options.name}' permanently deleted from ${options.pod}/${options.stream}`,
        );
      } else {
        const errorMessage =
          result.error.message ||
          result.error.code ||
          "Failed to delete record";
        throw new Error(errorMessage);
      }
    } else {
      // Soft delete - write tombstone record
      const tombstoneContent = JSON.stringify({ deleted: true });
      const path = `/${options.stream}/${options.name}`;

      const result = await podRequest(options.pod, path, {
        method: "POST",
        body: tombstoneContent,
        headers: {
          "Content-Type": "application/json",
        },
        token: options.token,
        server: options.server,
        profile: options.profile,
      });

      logger.debug("Delete (tombstone) response", {
        success: result.success,
        error: result.success ? null : result.error,
      });

      if (result.success) {
        output.success(
          `Record '${options.name}' marked as deleted in ${options.pod}/${options.stream}`,
        );
      } else {
        const errorMessage =
          result.error.message ||
          result.error.code ||
          "Failed to delete record";
        throw new Error(errorMessage);
      }
    }

    logger.info("Record deleted successfully", {
      pod: options.pod,
      stream: options.stream,
      name: options.name,
      hard: options.hard,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Delete command failed", {
      pod: options.pod,
      stream: options.stream,
      name: options.name,
      error: errorMessage,
    });
    output.error("Error: " + errorMessage);
    process.exit(1);
  }
}
