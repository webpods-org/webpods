#!/usr/bin/env node

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import os from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.resolve(__dirname, '../webpods-cli/dist/index.js');

// Create temp config dir
const configDir = path.join(os.tmpdir(), `test-cli-${Date.now()}`);
await fs.mkdir(configDir, { recursive: true });

console.log('Testing login command with config dir:', configDir);

const child = spawn('node', [cliPath, 'login', '--server', 'http://localhost:3456'], {
  stdio: 'pipe',
  env: {
    ...process.env,
    HOME: configDir,
    CLI_SILENT: 'true'
  }
});

let stdout = '';
let stderr = '';

child.stdout.on('data', (data) => {
  stdout += data.toString();
});

child.stderr.on('data', (data) => {
  stderr += data.toString();
});

child.on('close', async (code) => {
  console.log('Exit code:', code);
  console.log('STDOUT:', stdout);
  console.log('STDERR:', stderr);
  
  // Clean up
  await fs.rm(configDir, { recursive: true, force: true });
});