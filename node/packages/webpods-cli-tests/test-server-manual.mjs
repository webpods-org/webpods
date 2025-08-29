#!/usr/bin/env node

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.resolve(__dirname, '../webpods/dist/index.js');
const configPath = path.resolve(__dirname, 'test-config.json');

console.log('Starting server manually...');
console.log('Server path:', serverPath);
console.log('Config path:', configPath);

const env = {
  ...process.env,
  NODE_ENV: "test",
  WEBPODS_TEST_MODE: "enabled",
  WEBPODS_CONFIG_PATH: configPath,
  WEBPODS_PORT: "3456",
  WEBPODS_DB_NAME: "webpodsdb_cli_test",
  WEBPODS_DB_HOST: "localhost",
  WEBPODS_DB_PORT: "5432",
  WEBPODS_DB_USER: "postgres",
  WEBPODS_DB_PASSWORD: "postgres",
  JWT_SECRET: "test-secret-key",
  SESSION_SECRET: "test-session-secret",
  PORT: "3456",
  LOG_LEVEL: "info",
  DOMAIN: "localhost",
};

const child = spawn('node', [serverPath], {
  env,
  stdio: 'pipe'
});

child.stdout.on('data', (data) => {
  console.log('STDOUT:', data.toString());
});

child.stderr.on('data', (data) => {
  console.log('STDERR:', data.toString());
});

child.on('close', (code) => {
  console.log('Server exited with code:', code);
});

// Keep process alive
setTimeout(() => {
  console.log('Stopping server...');
  child.kill();
}, 10000);