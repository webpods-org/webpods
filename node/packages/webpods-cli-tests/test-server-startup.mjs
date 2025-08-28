#!/usr/bin/env node

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.resolve(__dirname, '../webpods/dist/index.js');
const configPath = path.resolve(__dirname, 'test-config.json');

console.log('Testing server startup messages...');

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
  const message = data.toString();
  console.log('STDOUT:', message);
  if (message.includes("WebPods server started")) {
    console.log('✅ FOUND STARTUP MESSAGE');
  }
});

child.stderr.on('data', (data) => {
  const message = data.toString();
  console.log('STDERR:', message);
  if (message.includes("WebPods server started")) {
    console.log('✅ FOUND STARTUP MESSAGE IN STDERR');
  }
});

setTimeout(() => {
  console.log('Stopping after 5 seconds...');
  child.kill();
}, 5000);