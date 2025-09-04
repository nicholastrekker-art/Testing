#!/usr/bin/env node

// Production startup script
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Set production environment
process.env.NODE_ENV = 'production';

// Check if built server exists
const builtServerPath = path.resolve(__dirname, 'dist', 'index.js');
const devServerPath = path.resolve(__dirname, 'server', 'index.ts');

if (fs.existsSync(builtServerPath)) {
  console.log('Starting production server...');
  const child = spawn('node', [builtServerPath], { 
    stdio: 'inherit',
    env: process.env 
  });
  
  child.on('exit', (code) => {
    process.exit(code);
  });
} else if (fs.existsSync(devServerPath)) {
  console.log('Built server not found, starting development server...');
  const child = spawn('npx', ['tsx', devServerPath], { 
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'development' }
  });
  
  child.on('exit', (code) => {
    process.exit(code);
  });
} else {
  console.error('No server file found!');
  process.exit(1);
}