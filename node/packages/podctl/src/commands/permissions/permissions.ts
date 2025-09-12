/**
 * Permission management commands
 */

import { podRequest } from "../../http/index.js";
import { createLogger, createCliOutput } from "../../logger.js";

const logger = createLogger("webpods:cli:permissions");

/**
 * Manage stream permissions
 */
export async function permissions(options: {
  quiet?: boolean;
  pod?: string;
  stream?: string;
  action?: string;
  mode?: string;
  user?: string;
  token?: string;
  server?: string;
  profile?: string;
  [key: string]: unknown;
}): Promise<void> {
  const output = createCliOutput(options.quiet);

  try {
    const action = options.action || "view";
    logger.debug("Permissions command", {
      pod: options.pod,
      stream: options.stream,
      action,
    });

    switch (action) {
      case "view":
        await viewPermissions(options);
        break;
      case "set":
        await setPermissions(options);
        break;
      case "grant":
        await grantPermission(options);
        break;
      case "revoke":
        await revokePermission(options);
        break;
      case "list":
        await listPermissions(options);
        break;
      default:
        output.error(`Unknown action: ${action}`);
        logger.error("Unknown permission action", { action });
        process.exit(1);
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Permissions command failed", {
      pod: options.pod,
      stream: options.stream,
      action: options.action,
      error: errorMessage,
    });
    output.error("Error: " + errorMessage);
    process.exit(1);
  }
}

async function viewPermissions(options: {
  quiet?: boolean;
  pod?: string;
  stream?: string;
  token?: string;
  server?: string;
  [key: string]: unknown;
}): Promise<void> {
  const output = createCliOutput(options.quiet);

  logger.debug("Viewing permissions", {
    pod: options.pod,
    stream: options.stream,
  });

  if (!options.pod || !options.stream) {
    output.error("Pod and stream are required for viewing permissions");
    process.exit(1);
  }

  // Get stream info to see current permission
  const result = await podRequest<{ access_permission?: string }>(
    options.pod,
    `/${options.stream}?info=true`,
    {
      token: options.token,
      server: options.server,
    },
  );

  if (!result.success) {
    output.error("Error: " + result.error.message);
    logger.error("Failed to get stream info for permissions", {
      pod: options.pod,
      stream: options.stream,
      error: result.error,
    });
    process.exit(1);
  }

  const streamInfo = result.data;
  const permission = streamInfo.access_permission || "public";
  logger.debug("Retrieved permission info", { permission });

  output.print(`Stream: ${options.pod}/${options.stream}`);
  output.print(`Permission: ${permission}`);

  if (permission.startsWith("/")) {
    output.print(`Access controlled by stream: ${permission}`);
  }

  logger.info("Permissions displayed", {
    pod: options.pod,
    stream: options.stream,
    permission,
  });
}

async function setPermissions(options: {
  quiet?: boolean;
  pod?: string;
  stream?: string;
  mode?: string;
  token?: string;
  server?: string;
  [key: string]: unknown;
}): Promise<void> {
  const output = createCliOutput(options.quiet);

  logger.debug("Setting permissions", {
    pod: options.pod,
    stream: options.stream,
    mode: options.mode,
  });

  if (!options.pod || !options.stream) {
    output.error("Pod and stream are required for setting permissions");
    process.exit(1);
  }

  if (!options.mode) {
    output.error(
      "Mode is required for set action. Use --mode public|private|/stream",
    );
    logger.error("No mode provided for set permission");
    process.exit(1);
  }

  const result = await podRequest<unknown>(
    options.pod,
    `/${options.stream}?access=${encodeURIComponent(options.mode)}`,
    {
      method: "POST",
      body: JSON.stringify({ permission: options.mode }),
      token: options.token,
      server: options.server,
    },
  );

  if (!result.success) {
    output.error("Error: " + result.error.message);
    logger.error("Failed to set permissions", {
      pod: options.pod,
      stream: options.stream,
      mode: options.mode,
      error: result.error,
    });
    process.exit(1);
  }

  output.success(
    `Permission set to '${options.mode}' for stream ${options.pod}/${options.stream}`,
  );
  logger.info("Permissions set successfully", {
    pod: options.pod,
    stream: options.stream,
    mode: options.mode,
  });
}

async function grantPermission(options: {
  quiet?: boolean;
  pod?: string;
  stream?: string;
  user?: string;
  token?: string;
  server?: string;
  [key: string]: unknown;
}): Promise<void> {
  const output = createCliOutput(options.quiet);

  logger.debug("Granting permission", {
    pod: options.pod,
    stream: options.stream,
    user: options.user,
  });

  if (!options.pod || !options.stream) {
    output.error("Pod and stream are required for granting permissions");
    process.exit(1);
  }

  if (!options.user) {
    output.error("User ID is required for grant action. Use --user <user-id>");
    logger.error("No user provided for grant permission");
    process.exit(1);
  }

  // This would write to a permission stream
  const permissionStream = options.stream.replace(/^\//, "") + "_permissions";
  logger.debug("Constructed permission stream", { permissionStream });

  const result = await podRequest<unknown>(
    options.pod,
    `/${permissionStream}/${options.user}`,
    {
      method: "POST",
      body: JSON.stringify({
        id: options.user,
        read: true,
        write: true,
      }),
      token: options.token,
      server: options.server,
    },
  );

  if (!result.success) {
    output.error("Error: " + result.error.message);
    logger.error("Failed to grant permission", {
      pod: options.pod,
      stream: options.stream,
      user: options.user,
      error: result.error,
    });
    process.exit(1);
  }

  output.success(
    `Granted access to user '${options.user}' for stream ${options.pod}/${options.stream}`,
  );
  logger.info("Permission granted successfully", {
    pod: options.pod,
    stream: options.stream,
    user: options.user,
  });
}

async function revokePermission(options: {
  quiet?: boolean;
  pod?: string;
  stream?: string;
  user?: string;
  token?: string;
  server?: string;
  [key: string]: unknown;
}): Promise<void> {
  const output = createCliOutput(options.quiet);

  logger.debug("Revoking permission", {
    pod: options.pod,
    stream: options.stream,
    user: options.user,
  });

  if (!options.pod || !options.stream) {
    output.error("Pod and stream are required for revoking permissions");
    process.exit(1);
  }

  if (!options.user) {
    output.error("User ID is required for revoke action. Use --user <user-id>");
    logger.error("No user provided for revoke permission");
    process.exit(1);
  }

  // This would write a deletion record to the permission stream
  const permissionStream = options.stream.replace(/^\//, "") + "_permissions";
  logger.debug("Constructed permission stream", { permissionStream });

  const result = await podRequest<unknown>(
    options.pod,
    `/${permissionStream}/${options.user}`,
    {
      method: "POST",
      body: JSON.stringify({
        id: options.user,
        deleted: true,
      }),
      token: options.token,
      server: options.server,
    },
  );

  if (!result.success) {
    output.error("Error: " + result.error.message);
    logger.error("Failed to revoke permission", {
      pod: options.pod,
      stream: options.stream,
      user: options.user,
      error: result.error,
    });
    process.exit(1);
  }

  output.success(
    `Revoked access for user '${options.user}' from stream ${options.pod}/${options.stream}`,
  );
  logger.info("Permission revoked successfully", {
    pod: options.pod,
    stream: options.stream,
    user: options.user,
  });
}

async function listPermissions(options: {
  quiet?: boolean;
  pod?: string;
  stream?: string;
  token?: string;
  server?: string;
  [key: string]: unknown;
}): Promise<void> {
  const output = createCliOutput(options.quiet);

  logger.debug("Listing permissions", {
    pod: options.pod,
    stream: options.stream,
  });

  if (!options.pod || !options.stream) {
    output.error("Pod and stream are required for listing permissions");
    process.exit(1);
  }

  // This would read from the permission stream
  const permissionStream = options.stream.replace(/^\//, "") + "_permissions";
  logger.debug("Constructed permission stream", { permissionStream });

  const result = await podRequest<{ records?: unknown[] }>(
    options.pod,
    `/${permissionStream}?unique=true`,
    {
      token: options.token,
      server: options.server,
    },
  );

  if (!result.success) {
    output.error("Error: " + result.error.message);
    logger.error("Failed to list permissions", {
      pod: options.pod,
      stream: options.stream,
      error: result.error,
    });
    process.exit(1);
  }

  const response = result.data;
  const records = response.records || [];
  logger.debug("Retrieved permission records", { count: records.length });

  if (records.length === 0) {
    output.print("No explicit permissions set for this stream.");
    return;
  }

  output.print(`Permissions for ${options.pod}/${options.stream}:`);
  output.print("─".repeat(40));

  let activePermissions = 0;
  records.forEach((record: unknown) => {
    if (record && typeof record === "object" && "content" in record) {
      const recordObj = record as { content: unknown };
      const content =
        typeof recordObj.content === "string"
          ? JSON.parse(recordObj.content)
          : recordObj.content;
      if (content && typeof content === "object" && "deleted" in content) {
        const contentObj = content as {
          deleted?: boolean;
          read?: boolean;
          write?: boolean;
          id?: string;
        };
        if (!contentObj.deleted) {
          const permissions = [];
          if (contentObj.read) permissions.push("read");
          if (contentObj.write) permissions.push("write");
          const id = contentObj.id || "unknown";
          output.print(`${id.padEnd(30)} ${permissions.join(", ")}`);
          activePermissions++;
        }
      }
    }
  });

  logger.info("Permissions listed successfully", {
    pod: options.pod,
    stream: options.stream,
    activePermissions,
  });
}
