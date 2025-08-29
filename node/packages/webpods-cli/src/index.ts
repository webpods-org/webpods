#!/usr/bin/env node

import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import type { ArgumentsCamelCase, Argv } from "yargs";
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
import { write, read, list } from "./commands/records/index.js";
import { streams, deleteStream } from "./commands/streams/index.js";
import { permissions } from "./commands/permissions/index.js";
import {
  oauthRegister,
  oauthList,
  oauthDelete,
  oauthInfo,
} from "./commands/oauth/index.js";
import { config, configSet, configServer } from "./commands/utils/index.js";
import {
  profileList,
  profileAdd,
  profileUse,
  profileDelete,
  profileCurrent,
} from "./commands/profile/index.js";

// Types and utilities
import { LoginArgs, ConfigArgs, GlobalOptions } from "./types.js";

export * as config from "./config/index.js";
export * as http from "./http/index.js";
export * as types from "./types.js";
export * as logger from "./logger.js";

import { createLogger, createCliOutput } from "./logger.js";

const logger = createLogger("webpods:cli");

// Disable deprecation warnings
(process as any).noDeprecation = true;

export async function main() {
  await yargs(hideBin(process.argv))
    // Authentication Commands
    .command(
      "login",
      "Print OAuth login link for manual token retrieval",
      (yargs: Argv) =>
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
      },
    )
    .command(
      "logout",
      "Clear stored authentication token",
      {},
      async (argv: ArgumentsCamelCase<GlobalOptions>) => {
        await logout(argv);
      },
    )
    .command(
      "whoami",
      "Show current authenticated user information",
      (yargs: Argv) =>
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
      async (argv: any) => {
        await whoami(argv);
      },
    )
    .command(
      "token-show",
      "Display current stored token",
      {},
      async (argv: ArgumentsCamelCase<GlobalOptions>) => {
        await token(argv);
      },
    )
    .command(
      "token-set <token>",
      "Manually set authentication token",
      (yargs: Argv) =>
        yargs.positional("token", {
          describe: "JWT token to store",
          demandOption: true,
          type: "string",
        }),
      async (argv: any) => {
        await tokenSet(argv);
      },
    )

    // Profile Management
    .command(
      "profile",
      "Manage server profiles",
      (yargs: Argv) =>
        yargs
          .command("list", "List all profiles", {}, async (argv: any) => {
            await profileList(argv);
          })
          .command(
            "add <name>",
            "Add a new profile",
            (yargs: Argv) =>
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
            async (argv: any) => {
              await profileAdd(argv);
            },
          )
          .command(
            "use <name>",
            "Switch to a different profile",
            (yargs: Argv) =>
              yargs.positional("name", {
                describe: "Profile name",
                demandOption: true,
                type: "string",
              }),
            async (argv: any) => {
              await profileUse(argv);
            },
          )
          .command(
            "delete <name>",
            "Delete a profile",
            (yargs: Argv) =>
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
            async (argv: any) => {
              await profileDelete(argv);
            },
          )
          .command("current", "Show current profile", {}, async (argv: any) => {
            await profileCurrent(argv);
          })
          .demandCommand(1, "Please specify a profile command"),
      () => {},
    )

    // Pod Management
    .command(
      "create <name>",
      "Create a new pod",
      (yargs: Argv) =>
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
      async (argv: any) => {
        await createPod(argv);
      },
    )
    .command(
      "pods",
      "List all your pods",
      (yargs: Argv) =>
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
      async (argv: any) => {
        await listPods(argv);
      },
    )
    .command(
      "delete <pod>",
      "Delete a pod and all its data",
      (yargs: Argv) =>
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
      async (argv: any) => {
        await deletePod(argv);
      },
    )
    .command(
      "info <pod>",
      "Show pod details and statistics",
      (yargs: Argv) =>
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
      async (argv: any) => {
        await infoPod(argv);
      },
    )

    // Stream & Record Operations
    .command(
      "write <pod> <stream> <name> [data]",
      "Write data to a stream record",
      (yargs: Argv) =>
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
      async (argv: any) => {
        await write(argv);
      },
    )
    .command(
      "read <pod> <stream> [name]",
      "Read data from a stream record",
      (yargs: Argv) =>
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
      async (argv: any) => {
        await read(argv);
      },
    )
    .command(
      "records <pod> <stream>",
      "List records in a stream",
      (yargs: Argv) =>
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
      async (argv: any) => {
        await list(argv);
      },
    )

    // Stream Management
    .command(
      "streams <pod>",
      "List all streams in a pod",
      (yargs: Argv) =>
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
      async (argv: any) => {
        await streams(argv);
      },
    )
    .command(
      "delete-stream <pod> <stream>",
      "Delete an entire stream",
      (yargs: Argv) =>
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
      async (argv: any) => {
        await deleteStream(argv);
      },
    )

    // Permission Management
    .command(
      "permissions <pod> <stream> [action]",
      "Manage stream permissions",
      (yargs: Argv) =>
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
      async (argv: any) => {
        await permissions(argv);
      },
    )

    // OAuth Client Management
    .command(
      "oauth register",
      "Register a new OAuth client",
      (yargs: Argv) =>
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
      async (argv: any) => {
        await oauthRegister(argv);
      },
    )
    .command(
      "oauth list",
      "List your OAuth clients",
      (yargs: Argv) =>
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
      async (argv: any) => {
        await oauthList(argv);
      },
    )
    .command(
      "oauth delete <clientId>",
      "Delete an OAuth client",
      (yargs: Argv) =>
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
      async (argv: any) => {
        await oauthDelete(argv);
      },
    )
    .command(
      "oauth info <clientId>",
      "Show OAuth client details",
      (yargs: Argv) =>
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
      async (argv: any) => {
        await oauthInfo(argv);
      },
    )

    // Utility Commands
    .command(
      "config [key] [value]",
      "Show or set configuration values",
      (yargs: Argv) =>
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
      },
    )
    .command(
      "config server <url>",
      "Set WebPods server URL",
      (yargs: Argv) =>
        yargs.positional("url", {
          describe: "Server URL",
          demandOption: true,
          type: "string",
        }),
      async (argv: any) => {
        await configServer(argv);
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

main().catch((error) => {
  logger.error("CLI startup failed", { error: error.message });
  const output = createCliOutput();
  output.error("Error: " + error.message);
  process.exit(1);
});
