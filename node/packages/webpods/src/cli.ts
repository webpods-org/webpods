#!/usr/bin/env node

/**
 * WebPods CLI entry point
 */

import { config } from 'dotenv';
import { start } from './index.js';
import { getFullVersion } from './version.js';

// Parse command line arguments
const args = process.argv.slice(2);

// Check for version flag
if (args.includes('-v') || args.includes('--version')) {
  console.info(getFullVersion());
  process.exit(0);
}

// Check for help flag
if (args.includes('-h') || args.includes('--help')) {
  console.info(`
WebPods - HTTP-based append-only logs

Usage: webpods [options]

Options:
  -v, --version    Show version number
  -h, --help       Show help
  -c, --config     Path to config.json file (default: ./config.json)
  -p, --port       Port to listen on (overrides config.json)
  -e, --env        Path to .env file (default: .env)

Environment Variables:
  DATABASE_URL     PostgreSQL connection string
  JWT_SECRET       Secret for JWT signing (required)
  SESSION_SECRET   Secret for session encryption
  DOMAIN           Base domain (default: webpods.org)

Examples:
  webpods                            Start with default config.json
  webpods -c config.json             Start with specified config
  webpods -c config.json -p 8080     Start on port 8080
  webpods -c prod.json -e prod.env   Use production config and env

Documentation: https://github.com/webpods-org/webpods
`);
  process.exit(0);
}

// Parse config file path (optional - will use defaults if not provided)
let configPath: string | undefined;
const configIndex = args.findIndex(arg => arg === '-c' || arg === '--config');
if (configIndex !== -1) {
  const configArg = args[configIndex + 1];
  if (!configArg) {
    console.error('Error: Config file path not provided after -c/--config flag');
    process.exit(1);
  }
  configPath = configArg;
}

// Parse port from command line
let port: number | undefined;
const portIndex = args.findIndex(arg => arg === '-p' || arg === '--port');
if (portIndex !== -1) {
  const portArg = args[portIndex + 1];
  if (!portArg) {
    console.error('Error: Port number not provided');
    process.exit(1);
  }
  const parsedPort = parseInt(portArg, 10);
  if (isNaN(parsedPort)) {
    console.error('Error: Invalid port number');
    process.exit(1);
  }
  port = parsedPort;
}

// Parse env file path
let envPath: string | undefined;
const envIndex = args.findIndex(arg => arg === '-e' || arg === '--env');
if (envIndex !== -1 && args[envIndex + 1]) {
  envPath = args[envIndex + 1];
}

// Load environment variables
config({ path: envPath });

// Set config path for the application if provided
if (configPath) {
  process.env.WEBPODS_CONFIG_PATH = configPath;
}

// Override port if specified on command line
if (port) {
  process.env.PORT = port.toString();
}

// Start the server
start();