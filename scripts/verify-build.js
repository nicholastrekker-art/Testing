#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Build verification script
function verifyBuild() {
  console.log('Verifying build setup...');
  
  const checks = [
    {
      name: 'Server source exists',
      path: path.resolve(__dirname, '..', 'server', 'index.ts'),
      required: true
    },
    {
      name: 'Package.json exists',
      path: path.resolve(__dirname, '..', 'package.json'),
      required: true
    },
    {
      name: 'Database config exists',
      path: path.resolve(__dirname, '..', 'drizzle.config.ts'),
      required: true
    },
    {
      name: 'Vite config exists',
      path: path.resolve(__dirname, '..', 'vite.config.ts'),
      required: true
    },
    {
      name: 'Client source exists',
      path: path.resolve(__dirname, '..', 'client'),
      required: true
    }
  ];
  
  let allPassed = true;
  
  checks.forEach(check => {
    const exists = fs.existsSync(check.path);
    const status = exists ? '✅' : (check.required ? '❌' : '⚠️');
    console.log(`${status} ${check.name}: ${check.path}`);
    
    if (check.required && !exists) {
      allPassed = false;
    }
  });
  
  if (allPassed) {
    console.log('\n✅ All required files present for deployment');
  } else {
    console.log('\n❌ Some required files are missing');
    process.exit(1);
  }
  
  // Check package.json scripts
  try {
    const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8'));
    console.log('\n📋 Available scripts:');
    Object.keys(packageJson.scripts || {}).forEach(script => {
      console.log(`  • ${script}: ${packageJson.scripts[script]}`);
    });
  } catch (error) {
    console.warn('Could not read package.json scripts');
  }
}

// Run if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  verifyBuild();
}

export default verifyBuild;