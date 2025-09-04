#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Post-build script to fix directory structure for deployment
function postBuild() {
  console.log('Running post-build setup...');
  
  const distPath = path.resolve(__dirname, '..', 'dist');
  const publicPath = path.resolve(distPath, 'public');
  const serverPath = path.resolve(__dirname, '..', 'server');
  
  // Create public directory if dist/public exists but public doesn't
  if (fs.existsSync(publicPath) && !fs.existsSync(path.resolve(serverPath, 'public'))) {
    console.log('Creating public symlink for static files...');
    try {
      // Create a symlink from server/public to dist/public
      const targetPath = path.resolve(serverPath, 'public');
      const relativePath = path.relative(serverPath, publicPath);
      fs.symlinkSync(relativePath, targetPath, 'dir');
      console.log('✅ Public directory symlink created');
    } catch (error) {
      console.log('Warning: Could not create symlink, copying files instead...');
      try {
        // execSync already imported
        execSync(`cp -r "${publicPath}" "${path.resolve(serverPath, 'public')}"`);
        console.log('✅ Public directory copied');
      } catch (copyError) {
        console.warn('Could not copy public directory:', copyError.message);
      }
    }
  }
  
  // Ensure the built server file exists
  const builtServerPath = path.resolve(distPath, 'index.js');
  if (!fs.existsSync(builtServerPath)) {
    console.warn('Warning: Built server file not found at', builtServerPath);
  } else {
    console.log('✅ Built server file found');
  }
  
  console.log('Post-build setup complete');
}

// Run if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  postBuild();
}

export default postBuild;