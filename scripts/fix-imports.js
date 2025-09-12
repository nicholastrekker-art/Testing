#!/usr/bin/env node

import { readdir, readFile, writeFile } from 'fs/promises';
import { join, dirname, extname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, '../dist');

async function fixImports(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    
    if (entry.isDirectory()) {
      await fixImports(fullPath);
    } else if (entry.isFile() && extname(entry.name) === '.js') {
      let content = await readFile(fullPath, 'utf8');
      
      // Fix all imports to work with ES modules
      
      // 1. Fix @shared/* imports to relative paths
      content = content.replace(
        /from\s+['"`]@shared\/([^'"`\s]*)['"`]/g,
        (match, subPath) => {
          // Determine the relative path from current file to shared folder
          const relativeDir = fullPath.includes('/server/') ? '../shared' : './shared';
          const newPath = `${relativeDir}/${subPath}.js`;
          return match.replace(`@shared/${subPath}`, newPath);
        }
      );
      
      content = content.replace(
        /import\s+['"`]@shared\/([^'"`\s]*)['"`]/g,
        (match, subPath) => {
          const relativeDir = fullPath.includes('/server/') ? '../shared' : './shared';
          const newPath = `${relativeDir}/${subPath}.js`;
          return match.replace(`@shared/${subPath}`, newPath);
        }
      );
      
      // 2. Fix relative "from 'path'" imports
      content = content.replace(
        /from\s+['"`]((?:\.\.|\.)[^'"`\s]*)['"`]/g,
        (match, importPath) => {
          if (!importPath.endsWith('.js') && !importPath.includes('?') && !importPath.includes('#')) {
            return match.replace(importPath, importPath + '.js');
          }
          return match;
        }
      );
      
      // 3. Fix "import 'path'" (side-effect imports)
      content = content.replace(
        /^import\s+['"`]((?:\.\.|\.)[^'"`\s]*)['"`]/gm,
        (match, importPath) => {
          if (!importPath.endsWith('.js') && !importPath.includes('?') && !importPath.includes('#')) {
            return match.replace(importPath, importPath + '.js');
          }
          return match;
        }
      );
      
      // 4. Fix dynamic import() calls
      content = content.replace(
        /import\s*\(\s*['"`]((?:\.\.|\.)[^'"`\s]*)['"`]\s*\)/g,
        (match, importPath) => {
          if (!importPath.endsWith('.js') && !importPath.includes('?') && !importPath.includes('#')) {
            return match.replace(importPath, importPath + '.js');
          }
          return match;
        }
      );
      
      await writeFile(fullPath, content);
    }
  }
}

console.log('🔧 Fixing ES module imports...');
await fixImports(distDir);
console.log('✅ Import paths fixed');