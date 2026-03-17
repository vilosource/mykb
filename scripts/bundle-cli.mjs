#!/usr/bin/env node

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'dist', 'cli-bundle');

// Read version from package.json
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
const version = pkg.version;

// Ensure output directory exists
fs.mkdirSync(outDir, { recursive: true });

// Bundle CLI with esbuild JS API (avoids shell quoting issues with shebang)
await esbuild.build({
  entryPoints: [path.join(root, 'src/cli/cli.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: path.join(outDir, 'cli.js'),
  external: ['better-sqlite3'],
  target: 'esnext',
  legalComments: 'none',
  define: { __MYKB_VERSION__: JSON.stringify(version) },
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
});

// Make executable
fs.chmodSync(path.join(outDir, 'cli.js'), 0o755);

// Write package.json for better-sqlite3 resolution
const bundlePkg = {
  name: 'mykb-cli',
  type: 'module',
  bin: { kb: './cli.js' },
  dependencies: {
    'better-sqlite3': pkg.dependencies['better-sqlite3'],
  },
};
fs.writeFileSync(path.join(outDir, 'package.json'), JSON.stringify(bundlePkg, null, 2) + '\n');

// Install better-sqlite3 (and its native deps) in the bundle directory
execSync('npm install --production', { cwd: outDir, stdio: 'inherit' });

console.log(`CLI bundled to ${outDir} (v${version})`);
