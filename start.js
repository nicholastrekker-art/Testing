#!/usr/bin/env node

// Development startup script
import { spawn } from 'child_process';

// Set development environment
process.env.NODE_ENV = 'development';

console.log('Starting development server...');
const child = spawn('npm', ['run', 'dev'], {
  stdio: 'inherit',
  env: process.env
});

child.on('exit', (code) => {
  process.exit(code);
});