#!/usr/bin/env node

import yargs from "yargs";
import type { ArgumentsCamelCase } from "yargs";
import process from "node:process";

// Command imports
import { login, logout, whoami, token, tokenSet } from "./commands/auth/index.js";
import { createPod, listPods, deletePod, infoPod } from "./commands/pods/index.js";
import { write, read, list } from "./commands/records/index.js";
import { streams, deleteStream } from "./commands/streams/index.js";
import { permissions } from "./commands/permissions/index.js";
import { oauthRegister, oauthList, oauthDelete, oauthInfo } from "./commands/oauth/index.js";
import { config, configSet, configServer } from "./commands/utils/index.js";

// Types and utilities
import { 
  LoginArgs,
  ConfigArgs,
  GlobalOptions
} from "./types.js";

export * as config from "./config/index.js";
export * as http from "./http/index.js";
export * as types from "./types.js";
export * as logger from "./logger.js";

import { createLogger, createCliOutput } from "./logger.js";

const logger = createLogger("webpods:cli");

// Disable deprecation warnings
(process as any).noDeprecation = true;

export async function main() {
  void yargs(process.argv.slice(2))
    // Authentication Commands
    .command(
      "login",
      "Print OAuth login link for manual token retrieval",
      (yargs) =>
        yargs
          .option("server", {
            type: "string",
            describe: "WebPods server URL",
          })
          .option("provider", {
            type: "string",
            describe: "OAuth provider (github, google, etc.)",
            default: "github",
          }),
      async (argv: ArgumentsCamelCase<LoginArgs>) => {
        await login(argv);
      }
    )
    .command(
      "logout",
      "Clear stored authentication token",
      {},
      async (argv: ArgumentsCamelCase<GlobalOptions>) => {
        await logout(argv);
      }
    )
    .command(
      "whoami",
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
      }
    )
    .command(
      "token",
      "Display current stored token",
      {},
      async (argv: ArgumentsCamelCase<GlobalOptions>) => {
        await token(argv);
      }
    )
    .command(
      "token set <token>",
      "Manually set authentication token",
      (yargs) =>
        yargs.positional("token", {
          describe: "JWT token to store",
          demandOption: true,
          type: "string",
        }),
      async (argv) => {
        await tokenSet(argv);
      }
    )

    // Pod Management
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
      }
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
      }
    )
    .command(
      "delete <pod>",
      "Delete a pod and all its data",
      (yargs) =>
        yargs
          .positional("pod", {
            describe: "Pod name to delete",
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
      }
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
            choices: ["json", "yaml", "table", "csv"] as const,
            describe: "Output format",
          }),
      async (argv) => {
        await infoPod(argv);
      }
    )

    // Stream & Record Operations  
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
      }
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
      }
    )
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
      }
    )

    // Stream Management
    .command(
      "streams <pod>",
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
      }
    )
    .command(
      "delete-stream <pod> <stream>",
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
      }
    )

    // Permission Management
    .command(
      "permissions <pod> <stream> [action]",
      "Manage stream permissions",
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
          .positional("action", {
            describe: "Action: view, set, grant, revoke, list",
            type: "string",
            choices: ["view", "set", "grant", "revoke", "list"],
            default: "view",
          })
          .option("mode", {
            type: "string",
            describe: "Permission mode (public, private, /stream)",
          })
          .option("user", {
            type: "string",
            describe: "User ID for grant/revoke actions",
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
      }
    )

    // OAuth Client Management
    .command(
      "oauth register",
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
      }
    )
    .command(
      "oauth list",
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
      }
    )
    .command(
      "oauth delete <clientId>",
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
      }
    )
    .command(
      "oauth info <clientId>",
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
      }
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
      async (argv: ArgumentsCamelCase<ConfigArgs>) => {
        if (argv.key && argv.value) {
          await configSet({ key: argv.key, value: argv.value, ...argv });
        } else {
          await config(argv);
        }
      }
    )
    .command(
      "config server <url>",
      "Set WebPods server URL",
      (yargs) =>
        yargs.positional("url", {
          describe: "Server URL",
          demandOption: true,
          type: "string",
        }),
      async (argv) => {
        await configServer(argv);
      }
    )

    // Global options
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

main().catch((error) => {
  logger.error("CLI startup failed", { error: error.message });
  const output = createCliOutput();
  output.error("Error: " + error.message);
  process.exit(1);
});