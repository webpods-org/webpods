#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');

const cliPath = path.resolve(__dirname, '../webpods-cli/dist/index.js');

console.log('Testing CLI at:', cliPath);
console.log('Running: node', cliPath, '--help');

const child = spawn('node', [cliPath, '--help'], {
  stdio: 'pipe'
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
});