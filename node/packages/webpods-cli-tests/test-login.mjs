#!/usr/bin/env node

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.resolve(__dirname, '../webpods-cli/dist/index.js');

console.log('Testing login command');

const child = spawn('node', [cliPath, 'login', '--server', 'http://localhost:3456'], {
  stdio: 'pipe',
  env: {
    ...process.env,
    HOME: '/tmp/test-cli'  // Use temp directory for config
  }
});

let stdout = '';
let stderr = '';

child.stdout.on('data', (data) => {
  stdout += data.toString();
  console.log('STDOUT:', data.toString());
});

child.stderr.on('data', (data) => {
  stderr += data.toString();
  console.log('STDERR:', data.toString());
});

child.on('close', (code) => {
  console.log('Exit code:', code);
  if (stderr) {
    console.log('Full stderr:', stderr);
  }
  if (!stdout.includes('To authenticate with WebPods:')) {
    console.log('ERROR: Expected output not found');
  }
});