#!/usr/bin/env node

import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import process from "node:process";

// Command imports
import {
  login,
  logout,
  whoami,
  token,
  tokenSet,
} from "./commands/auth/index.js";
import {
  createPod,
  listPods,
  deletePod,
  infoPod,
} from "./commands/pods/index.js";
import { write, read, list, deleteRecord } from "./commands/records/index.js";
import {
  streams,
  deleteStream,
  createStream,
  syncStream,
  downloadStream,
} from "./commands/streams/index.js";
import { permissions } from "./commands/permissions/index.js";
import {
  oauthRegister,
  oauthList,
  oauthDelete,
  oauthInfo,
} from "./commands/oauth/index.js";
import { config, configSet } from "./commands/utils/index.js";
import {
  profileList,
  profileAdd,
  profileUse,
  profileDelete,
  profileCurrent,
} from "./commands/profile/index.js";
// New command imports
import { grant, revoke } from "./commands/grant/index.js";
import { linksSet, linksList, linksRemove } from "./commands/links/index.js";
import {
  domainAdd,
  domainList,
  domainRemove,
} from "./commands/domains/index.js";
import { verify } from "./commands/verify/index.js";
import { schemaEnable, schemaDisable } from "./commands/schema/index.js";
import { transfer } from "./commands/transfer/index.js";
import { limits } from "./commands/limits/index.js";

export * as config from "./config/index.js";
export * as http from "./http/index.js";
export * as types from "./types.js";
export * as logger from "./logger.js";

import { createLogger, createCliOutput } from "./logger.js";

const logger = createLogger("webpods:cli");

// Disable deprecation warnings
// eslint-disable-next-line no-undef
(process as NodeJS.Process & { noDeprecation?: boolean }).noDeprecation = true;

export async function main() {
  await yargs(hideBin(process.argv))
    // Authentication Management
    .command(
      "auth",
      "Manage authentication",
      (yargs) =>
        yargs
          .command(
            "login",
            "Show available OAuth providers for authentication",
            {},
            async (argv) => {
              await login(argv);
            },
          )
          .command(
            "logout",
            "Clear stored authentication token",
            {},
            async (argv) => {
              await logout(argv);
            },
          )
          .command(
            "info",
            "Show current authenticated user information",
            (yargs) =>
              yargs
                .option("token", {
                  type: "string",
                  describe: "Use specific token for this command",
                })
                .option("server", {
                  type: "string",
                  describe: "WebPods server URL",
                })
                .option("format", {
                  type: "string",
                  choices: ["json", "yaml", "table", "csv"] as const,
                  describe: "Output format",
                }),
            async (argv) => {
              await whoami(argv);
            },
          )
          .demandCommand(1, "Please specify an auth command"),
      () => {},
    )
    // Token subcommands
    .command(
      "token",
      "Manage authentication tokens",
      (yargs) =>
        yargs
          .command("show", "Display current stored token", {}, async (argv) => {
            await token(argv);
          })
          .command(
            "get",
            "Display current stored token (alias for show)",
            {},
            async (argv) => {
              await token(argv);
            },
          )
          .command(
            "set <token>",
            "Manually set authentication token",
            (yargs) =>
              yargs.positional("token", {
                describe: "JWT token to store",
                demandOption: true,
                type: "string",
              }),
            async (argv) => {
              await tokenSet(argv);
            },
          )
          .demandCommand(1, "Please specify a token command"),
      () => {},
    )

    // Profile Management
    .command(
      "profile",
      "Manage server profiles",
      (yargs) =>
        yargs
          .command("list", "List all profiles", {}, async (argv) => {
            await profileList(argv);
          })
          .command(
            "add <name>",
            "Add a new profile",
            (yargs) =>
              yargs
                .positional("name", {
                  describe: "Profile name",
                  demandOption: true,
                  type: "string",
                })
                .option("server", {
                  type: "string",
                  demandOption: true,
                  describe: "WebPods server URL",
                }),
            async (argv) => {
              await profileAdd(argv);
            },
          )
          .command(
            "use <name>",
            "Switch to a different profile",
            (yargs) =>
              yargs.positional("name", {
                describe: "Profile name",
                demandOption: true,
                type: "string",
              }),
            async (argv) => {
              await profileUse(argv);
            },
          )
          .command(
            "delete <name>",
            "Delete a profile",
            (yargs) =>
              yargs
                .positional("name", {
                  describe: "Profile name",
                  demandOption: true,
                  type: "string",
                })
                .option("force", {
                  type: "boolean",
                  describe: "Skip confirmation prompt",
                }),
            async (argv) => {
              await profileDelete(argv);
            },
          )
          .command("current", "Show current profile", {}, async (argv) => {
            await profileCurrent(argv);
          })
          .demandCommand(1, "Please specify a profile command"),
      () => {},
    )

    // Pod Management
    .command(
      "pod",
      "Manage pods",
      (yargs) =>
        yargs
          .command(
            "create <name>",
            "Create a new pod",
            (yargs) =>
              yargs
                .positional("name", {
                  describe: "Pod name (subdomain)",
                  demandOption: true,
                  type: "string",
                })
                .option("token", {
                  type: "string",
                  describe: "Use specific token for this command",
                })
                .option("server", {
                  type: "string",
                  describe: "WebPods server URL",
                }),
            async (argv) => {
              await createPod(argv);
            },
          )
          .command(
            "list",
            "List all your pods",
            (yargs) =>
              yargs
                .option("token", {
                  type: "string",
                  describe: "Use specific token for this command",
                })
                .option("server", {
                  type: "string",
                  describe: "WebPods server URL",
                })
                .option("format", {
                  type: "string",
                  choices: ["json", "yaml", "table", "csv"] as const,
                  describe: "Output format",
                }),
            async (argv) => {
              await listPods(argv);
            },
          )
          .command(
            "delete <pod>",
            "Delete a pod and all its data",
            (yargs) =>
              yargs
                .positional("pod", {
                  describe: "Pod to delete",
                  demandOption: true,
                  type: "string",
                })
                .option("token", {
                  type: "string",
                  describe: "Use specific token for this command",
                })
                .option("server", {
                  type: "string",
                  describe: "WebPods server URL",
                })
                .option("force", {
                  type: "boolean",
                  describe: "Skip confirmation prompt",
                }),
            async (argv) => {
              await deletePod(argv);
            },
          )
          .command(
            "info <pod>",
            "Show pod details and statistics",
            (yargs) =>
              yargs
                .positional("pod", {
                  describe: "Pod name",
                  demandOption: true,
                  type: "string",
                })
                .option("token", {
                  type: "string",
                  describe: "Use specific token for this command",
                })
                .option("server", {
                  type: "string",
                  describe: "WebPods server URL",
                })
                .option("format", {
                  type: "string",
                  choices: ["json", "yaml", "table"] as const,
                  describe: "Output format",
                }),
            async (argv) => {
              await infoPod(argv);
            },
          )
          .command(
            "transfer <pod> <user>",
            "Transfer pod ownership",
            (yargs) =>
              yargs
                .positional("pod", {
                  describe: "Pod to transfer",
                  demandOption: true,
                  type: "string",
                })
                .positional("user", {
                  describe: "New owner user ID",
                  demandOption: true,
                  type: "string",
                })
                .option("force", {
                  type: "boolean",
                  describe: "Skip confirmation prompt",
                })
                .option("token", {
                  type: "string",
                  describe: "Use specific token for this command",
                })
                .option("server", {
                  type: "string",
                  describe: "WebPods server URL",
                }),
            async (argv) => {
              await transfer(argv);
            },
          )
          .demandCommand(1, "Please specify a pod command"),
      () => {},
    )

    // Record Management
    .command(
      "record",
      "Manage records",
      (yargs) =>
        yargs
          .command(
            "list <pod> <stream>",
            "List records in a stream",
            (yargs) =>
              yargs
                .positional("pod", {
                  describe: "Pod name",
                  demandOption: true,
                  type: "string",
                })
                .positional("stream", {
                  describe: "Stream path",
                  demandOption: true,
                  type: "string",
                })
                .option("limit", {
                  type: "number",
                  describe: "Maximum number of records",
                  default: 50,
                })
                .option("after", {
                  type: "number",
                  describe: "Start after index",
                })
                .option("unique", {
                  type: "boolean",
                  describe: "Show only unique named records",
                })
                .option("recursive", {
                  type: "boolean",
                  describe: "Include records from nested streams",
                })
                .option("token", {
                  type: "string",
                  describe: "Use specific token for this command",
                })
                .option("server", {
                  type: "string",
                  describe: "WebPods server URL",
                })
                .option("format", {
                  type: "string",
                  choices: ["json", "yaml", "table", "csv"] as const,
                  describe: "Output format",
                }),
            async (argv) => {
              await list(argv);
            },
          )
          .command(
            "write <pod> <stream> <name> [data]",
            "Write data to a stream record",
            (yargs) =>
              yargs
                .positional("pod", {
                  describe: "Pod name",
                  demandOption: true,
                  type: "string",
                })
                .positional("stream", {
                  describe: "Stream path",
                  demandOption: true,
                  type: "string",
                })
                .positional("name", {
                  describe: "Record name",
                  demandOption: true,
                  type: "string",
                })
                .positional("data", {
                  describe: "Data to write",
                  type: "string",
                })
                .option("file", {
                  alias: "f",
                  type: "string",
                  describe: "Read data from file",
                })
                .option("permission", {
                  type: "string",
                  describe: "Set access permission (public, private, /stream)",
                })
                .option("token", {
                  type: "string",
                  describe: "Use specific token for this command",
                })
                .option("server", {
                  type: "string",
                  describe: "WebPods server URL",
                }),
            async (argv) => {
              await write(argv);
            },
          )
          .command(
            "read <pod> <stream> [name]",
            "Read data from a stream record",
            (yargs) =>
              yargs
                .positional("pod", {
                  describe: "Pod name",
                  demandOption: true,
                  type: "string",
                })
                .positional("stream", {
                  describe: "Stream path",
                  demandOption: true,
                  type: "string",
                })
                .positional("name", {
                  describe: "Record name",
                  type: "string",
                })
                .option("index", {
                  alias: "i",
                  type: "string",
                  describe: "Read by index (-1 for latest, 0:10 for range)",
                })
                .option("output", {
                  alias: "o",
                  type: "string",
                  describe: "Save to file",
                })
                .option("token", {
                  type: "string",
                  describe: "Use specific token for this command",
                })
                .option("server", {
                  type: "string",
                  describe: "WebPods server URL",
                }),
            async (argv) => {
              await read(argv);
            },
          )
          .command(
            "delete <pod> <stream> <name>",
            "Delete a record (soft delete by default)",
            (yargs) =>
              yargs
                .positional("pod", {
                  describe: "Pod name",
                  demandOption: true,
                  type: "string",
                })
                .positional("stream", {
                  describe: "Stream path",
                  demandOption: true,
                  type: "string",
                })
                .positional("name", {
                  describe: "Record name",
                  demandOption: true,
                  type: "string",
                })
                .option("hard", {
                  type: "boolean",
                  describe: "Permanently delete (purge) the record",
                  default: false,
                })
                .option("token", {
                  type: "string",
                  describe: "Use specific token for this command",
                })
                .option("server", {
                  type: "string",
                  describe: "WebPods server URL",
                }),
            async (argv) => {
              await deleteRecord(argv);
            },
          )
          .command(
            "verify <pod> <stream>",
            "Verify hash chain integrity",
            (yargs) =>
              yargs
                .positional("pod", {
                  describe: "Pod name",
                  demandOption: true,
                  type: "string",
                })
                .positional("stream", {
                  describe: "Stream to verify",
                  demandOption: true,
                  type: "string",
                })
                .option("show-chain", {
                  type: "boolean",
                  describe: "Display full hash chain",
                })
                .option("check-integrity", {
                  type: "boolean",
                  describe: "Verify hash chain integrity",
                })
                .option("token", {
                  type: "string",
                  describe: "Use specific token for this command",
                })
                .option("server", {
                  type: "string",
                  describe: "WebPods server URL",
                }),
            async (argv) => {
              await verify(argv);
            },
          )
          .demandCommand(1, "Please specify a record command"),
      () => {},
    )

    // Stream Management
    .command(
      "stream",
      "Manage streams",
      (yargs) =>
        yargs
          .command(
            "list <pod>",
            "List all streams in a pod",
            (yargs) =>
              yargs
                .positional("pod", {
                  describe: "Pod name",
                  demandOption: true,
                  type: "string",
                })
                .option("token", {
                  type: "string",
                  describe: "Use specific token for this command",
                })
                .option("server", {
                  type: "string",
                  describe: "WebPods server URL",
                })
                .option("format", {
                  type: "string",
                  choices: ["json", "yaml", "table", "csv"] as const,
                  describe: "Output format",
                }),
            async (argv) => {
              await streams(argv);
            },
          )
          .command(
            "create <pod> <stream>",
            "Create a new stream",
            (yargs) =>
              yargs
                .positional("pod", {
                  describe: "Pod name",
                  demandOption: true,
                  type: "string",
                })
                .positional("stream", {
                  describe: "Stream path",
                  demandOption: true,
                  type: "string",
                })
                .option("access", {
                  type: "string",
                  describe:
                    "Access permission (public, private, or path to permission stream)",
                  default: "public",
                })
                .option("token", {
                  type: "string",
                  describe: "Use specific token for this command",
                })
                .option("server", {
                  type: "string",
                  describe: "WebPods server URL",
                }),
            async (argv) => {
              await createStream(argv);
            },
          )
          .command(
            "delete <pod> <stream>",
            "Delete an entire stream",
            (yargs) =>
              yargs
                .positional("pod", {
                  describe: "Pod name",
                  demandOption: true,
                  type: "string",
                })
                .positional("stream", {
                  describe: "Stream path",
                  demandOption: true,
                  type: "string",
                })
                .option("token", {
                  type: "string",
                  describe: "Use specific token for this command",
                })
                .option("server", {
                  type: "string",
                  describe: "WebPods server URL",
                })
                .option("force", {
                  type: "boolean",
                  describe: "Skip confirmation prompt",
                }),
            async (argv) => {
              await deleteStream(argv);
            },
          )
          .command(
            "sync <pod> <stream> <path>",
            "Sync local directory to stream",
            (yargs) =>
              yargs
                .positional("pod", {
                  describe: "Pod name",
                  demandOption: true,
                  type: "string",
                })
                .positional("stream", {
                  describe: "Stream path",
                  demandOption: true,
                  type: "string",
                })
                .positional("path", {
                  describe: "Local directory path",
                  demandOption: true,
                  type: "string",
                })
                .option("token", {
                  type: "string",
                  describe: "Use specific token for this command",
                })
                .option("server", {
                  type: "string",
                  describe: "WebPods server URL",
                })
                .option("verbose", {
                  type: "boolean",
                  describe: "Show detailed sync progress",
                })
                .option("dry-run", {
                  type: "boolean",
                  describe: "Show what would be synced without making changes",
                }),
            async (argv) => {
              await syncStream(argv.pod, argv.stream, argv.path, argv);
            },
          )
          .command(
            "download <pod> <stream> <path>",
            "Download stream records to local directory",
            (yargs) =>
              yargs
                .positional("pod", {
                  describe: "Pod name",
                  demandOption: true,
                  type: "string",
                })
                .positional("stream", {
                  describe: "Stream path",
                  demandOption: true,
                  type: "string",
                })
                .positional("path", {
                  describe: "Local directory path",
                  demandOption: true,
                  type: "string",
                })
                .option("token", {
                  type: "string",
                  describe: "Use specific token for this command",
                })
                .option("server", {
                  type: "string",
                  describe: "WebPods server URL",
                })
                .option("verbose", {
                  type: "boolean",
                  describe: "Show detailed download progress",
                })
                .option("overwrite", {
                  type: "boolean",
                  describe: "Overwrite existing files",
                }),
            async (argv) => {
              await downloadStream(argv.pod, argv.stream, argv.path, argv);
            },
          )
          .demandCommand(1, "Please specify a stream command"),
      () => {},
    )

    // Permission Management
    .command(
      "permission",
      "Manage permissions",
      (yargs) =>
        yargs
          .command(
            "list <pod> <stream>",
            "List permissions for a stream",
            (yargs) =>
              yargs
                .positional("pod", {
                  describe: "Pod name",
                  demandOption: true,
                  type: "string",
                })
                .positional("stream", {
                  describe: "Permission stream path",
                  demandOption: true,
                  type: "string",
                })
                .option("user", {
                  type: "string",
                  describe: "Filter by user ID",
                })
                .option("token", {
                  type: "string",
                  describe: "Use specific token for this command",
                })
                .option("server", {
                  type: "string",
                  describe: "WebPods server URL",
                })
                .option("format", {
                  type: "string",
                  choices: ["json", "yaml", "table", "csv"] as const,
                  describe: "Output format",
                }),
            async (argv) => {
              await permissions(argv);
            },
          )
          .command(
            "grant <pod> <stream> <user>",
            "Grant permissions to a user",
            (yargs) =>
              yargs
                .positional("pod", {
                  describe: "Pod name",
                  demandOption: true,
                  type: "string",
                })
                .positional("stream", {
                  describe: "Permission stream path",
                  demandOption: true,
                  type: "string",
                })
                .positional("user", {
                  describe: "User ID to grant permissions to",
                  demandOption: true,
                  type: "string",
                })
                .option("read", {
                  type: "boolean",
                  describe: "Grant read permission",
                })
                .option("write", {
                  type: "boolean",
                  describe: "Grant write permission",
                })
                .option("token", {
                  type: "string",
                  describe: "Use specific token for this command",
                })
                .option("server", {
                  type: "string",
                  describe: "WebPods server URL",
                }),
            async (argv) => {
              await grant(argv);
            },
          )
          .command(
            "revoke <pod> <stream> <user>",
            "Revoke permissions from a user",
            (yargs) =>
              yargs
                .positional("pod", {
                  describe: "Pod name",
                  demandOption: true,
                  type: "string",
                })
                .positional("stream", {
                  describe: "Permission stream path",
                  demandOption: true,
                  type: "string",
                })
                .positional("user", {
                  describe: "User ID to revoke permissions from",
                  demandOption: true,
                  type: "string",
                })
                .option("token", {
                  type: "string",
                  describe: "Use specific token for this command",
                })
                .option("server", {
                  type: "string",
                  describe: "WebPods server URL",
                }),
            async (argv) => {
              await revoke(argv);
            },
          )
          .demandCommand(1, "Please specify a permission command"),
      () => {},
    )

    // Link Management
    .command(
      "link",
      "Manage pod links and routing",
      (yargs) =>
        yargs
          .command(
            "set <pod> <path> <target>",
            "Set a link/route",
            (yargs) =>
              yargs
                .positional("pod", {
                  describe: "Pod name",
                  demandOption: true,
                  type: "string",
                })
                .positional("path", {
                  describe: "URL path (e.g., /about)",
                  demandOption: true,
                  type: "string",
                })
                .positional("target", {
                  describe: "Target stream/record",
                  demandOption: true,
                  type: "string",
                })
                .option("token", {
                  type: "string",
                  describe: "Use specific token for this command",
                })
                .option("server", {
                  type: "string",
                  describe: "WebPods server URL",
                }),
            async (argv) => {
              await linksSet(argv);
            },
          )
          .command(
            "list <pod>",
            "List all links for a pod",
            (yargs) =>
              yargs
                .positional("pod", {
                  describe: "Pod name",
                  demandOption: true,
                  type: "string",
                })
                .option("format", {
                  type: "string",
                  choices: ["json", "yaml", "table", "csv"] as const,
                  describe: "Output format",
                })
                .option("token", {
                  type: "string",
                  describe: "Use specific token for this command",
                })
                .option("server", {
                  type: "string",
                  describe: "WebPods server URL",
                }),
            async (argv) => {
              await linksList(argv);
            },
          )
          .command(
            "remove <pod> <path>",
            "Remove a link",
            (yargs) =>
              yargs
                .positional("pod", {
                  describe: "Pod name",
                  demandOption: true,
                  type: "string",
                })
                .positional("path", {
                  describe: "URL path to remove",
                  demandOption: true,
                  type: "string",
                })
                .option("token", {
                  type: "string",
                  describe: "Use specific token for this command",
                })
                .option("server", {
                  type: "string",
                  describe: "WebPods server URL",
                }),
            async (argv) => {
              await linksRemove(argv);
            },
          )
          .demandCommand(1, "Please specify a link command"),
      () => {},
    )

    // Domain Management
    .command(
      "domain",
      "Manage custom domains",
      (yargs) =>
        yargs
          .command(
            "add <pod> <domain>",
            "Add a custom domain",
            (yargs) =>
              yargs
                .positional("pod", {
                  describe: "Pod name",
                  demandOption: true,
                  type: "string",
                })
                .positional("domain", {
                  describe: "Custom domain (e.g., blog.example.com)",
                  demandOption: true,
                  type: "string",
                })
                .option("token", {
                  type: "string",
                  describe: "Use specific token for this command",
                })
                .option("server", {
                  type: "string",
                  describe: "WebPods server URL",
                }),
            async (argv) => {
              await domainAdd(argv);
            },
          )
          .command(
            "list <pod>",
            "List custom domains for a pod",
            (yargs) =>
              yargs
                .positional("pod", {
                  describe: "Pod name",
                  demandOption: true,
                  type: "string",
                })
                .option("format", {
                  type: "string",
                  choices: ["json", "yaml", "table", "csv"] as const,
                  describe: "Output format",
                })
                .option("token", {
                  type: "string",
                  describe: "Use specific token for this command",
                })
                .option("server", {
                  type: "string",
                  describe: "WebPods server URL",
                }),
            async (argv) => {
              await domainList(argv);
            },
          )
          .command(
            "remove <pod> <domain>",
            "Remove a custom domain",
            (yargs) =>
              yargs
                .positional("pod", {
                  describe: "Pod name",
                  demandOption: true,
                  type: "string",
                })
                .positional("domain", {
                  describe: "Domain to remove",
                  demandOption: true,
                  type: "string",
                })
                .option("token", {
                  type: "string",
                  describe: "Use specific token for this command",
                })
                .option("server", {
                  type: "string",
                  describe: "WebPods server URL",
                }),
            async (argv) => {
              await domainRemove(argv);
            },
          )
          .demandCommand(1, "Please specify a domain command"),
      () => {},
    )

    // Schema Management
    .command(
      "schema",
      "Manage stream validation schemas",
      (yargs) =>
        yargs
          .command(
            "enable <pod> <stream> <file>",
            "Enable schema validation for a stream",
            (yargs) =>
              yargs
                .positional("pod", {
                  describe: "Pod name",
                  demandOption: true,
                  type: "string",
                })
                .positional("stream", {
                  describe: "Stream path",
                  demandOption: true,
                  type: "string",
                })
                .positional("file", {
                  describe: "JSON schema file",
                  demandOption: true,
                  type: "string",
                })
                .option("mode", {
                  type: "string",
                  choices: ["strict", "permissive"],
                  default: "strict",
                  describe: "Validation mode",
                })
                .option("applies-to", {
                  type: "string",
                  choices: ["content", "full-record"],
                  default: "content",
                  describe: "What to validate",
                })
                .option("verbose", {
                  type: "boolean",
                  describe: "Show detailed output",
                })
                .option("token", {
                  type: "string",
                  describe: "Use specific token for this command",
                })
                .option("server", {
                  type: "string",
                  describe: "WebPods server URL",
                }),
            async (argv) => {
              await schemaEnable(argv);
            },
          )
          .command(
            "disable <pod> <stream>",
            "Disable schema validation for a stream",
            (yargs) =>
              yargs
                .positional("pod", {
                  describe: "Pod name",
                  demandOption: true,
                  type: "string",
                })
                .positional("stream", {
                  describe: "Stream path",
                  demandOption: true,
                  type: "string",
                })
                .option("token", {
                  type: "string",
                  describe: "Use specific token for this command",
                })
                .option("server", {
                  type: "string",
                  describe: "WebPods server URL",
                }),
            async (argv) => {
              await schemaDisable(argv);
            },
          )
          .demandCommand(1, "Please specify a schema command"),
      () => {},
    )

    // Rate Limits
    // Rate Limit Management
    .command(
      "limit",
      "Manage rate limits",
      (yargs) =>
        yargs
          .command(
            "info",
            "Check rate limit status",
            (yargs) =>
              yargs
                .option("action", {
                  type: "string",
                  describe: "Specific action to check (read, write, etc.)",
                })
                .option("format", {
                  type: "string",
                  choices: ["json", "yaml", "table", "csv"] as const,
                  describe: "Output format",
                })
                .option("token", {
                  type: "string",
                  describe: "Use specific token for this command",
                })
                .option("server", {
                  type: "string",
                  describe: "WebPods server URL",
                }),
            async (argv) => {
              await limits(argv);
            },
          )
          .demandCommand(1, "Please specify a limit command"),
      () => {},
    )

    // OAuth Client Management
    .command(
      "oauth",
      "Manage OAuth clients",
      (yargs) =>
        yargs
          .command(
            "register",
            "Register a new OAuth client",
            (yargs) =>
              yargs
                .option("name", {
                  type: "string",
                  demandOption: true,
                  describe: "Application name",
                })
                .option("redirect", {
                  type: "string",
                  demandOption: true,
                  describe: "Redirect URI",
                })
                .option("pods", {
                  type: "string",
                  describe: "Comma-separated list of pods to request access to",
                })
                .option("token", {
                  type: "string",
                  describe: "Use specific token for this command",
                })
                .option("server", {
                  type: "string",
                  describe: "WebPods server URL",
                }),
            async (argv) => {
              await oauthRegister(argv);
            },
          )
          .command(
            "list",
            "List your OAuth clients",
            (yargs) =>
              yargs
                .option("token", {
                  type: "string",
                  describe: "Use specific token for this command",
                })
                .option("server", {
                  type: "string",
                  describe: "WebPods server URL",
                })
                .option("format", {
                  type: "string",
                  choices: ["json", "yaml", "table", "csv"] as const,
                  describe: "Output format",
                }),
            async (argv) => {
              await oauthList(argv);
            },
          )
          .command(
            "delete <clientId>",
            "Delete an OAuth client",
            (yargs) =>
              yargs
                .positional("clientId", {
                  describe: "Client ID to delete",
                  demandOption: true,
                  type: "string",
                })
                .option("token", {
                  type: "string",
                  describe: "Use specific token for this command",
                })
                .option("server", {
                  type: "string",
                  describe: "WebPods server URL",
                })
                .option("force", {
                  type: "boolean",
                  describe: "Skip confirmation prompt",
                }),
            async (argv) => {
              await oauthDelete(argv);
            },
          )
          .command(
            "info <clientId>",
            "Show OAuth client details",
            (yargs) =>
              yargs
                .positional("clientId", {
                  describe: "Client ID",
                  demandOption: true,
                  type: "string",
                })
                .option("token", {
                  type: "string",
                  describe: "Use specific token for this command",
                })
                .option("server", {
                  type: "string",
                  describe: "WebPods server URL",
                })
                .option("format", {
                  type: "string",
                  choices: ["json", "yaml", "table", "csv"] as const,
                  describe: "Output format",
                }),
            async (argv) => {
              await oauthInfo(argv);
            },
          )
          .demandCommand(1, "Please specify an oauth command"),
      () => {},
    )

    // Utility Commands
    .command(
      "config [key] [value]",
      "Show or set configuration values",
      (yargs) =>
        yargs
          .positional("key", {
            describe: "Configuration key",
            type: "string",
          })
          .positional("value", {
            describe: "Configuration value",
            type: "string",
          }),
      async (argv) => {
        if (argv.key && argv.value) {
          await configSet(argv);
        } else {
          await config(argv);
        }
      },
    )

    // Top-level aliases for common commands
    .command(
      "login",
      "Authenticate with WebPods (alias for auth login)",
      {},
      async (argv) => {
        await login(argv);
      },
    )
    .command(
      "logout",
      "Clear authentication (alias for auth logout)",
      {},
      async (argv) => {
        await logout(argv);
      },
    )

    // Global options
    .option("profile", {
      type: "string",
      global: true,
      describe: "Use a specific profile",
    })
    .option("quiet", {
      type: "boolean",
      global: true,
      describe: "Suppress non-essential output",
    })
    .option("verbose", {
      type: "boolean",
      global: true,
      describe: "Detailed output",
    })
    .option("no-color", {
      type: "boolean",
      global: true,
      describe: "Disable colored output",
    })
    .showHelpOnFail(false)
    .completion()
    .help("help")
    .alias("h", "help")
    .version("0.0.1").argv;
}

main().catch((error: unknown) => {
  const errorMessage = error instanceof Error ? error.message : String(error);
  logger.error("CLI startup failed", { error: errorMessage });
  const output = createCliOutput();
  output.error("Error: " + errorMessage);
  process.exit(1);
});
