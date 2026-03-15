import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import type { ManifestFile } from './types.js';

export function initBrain(brainPath: string): void {
  // Create brain directory
  fs.mkdirSync(brainPath, { recursive: true });

  // Create areas directory
  const areasDir = path.join(brainPath, 'areas');
  fs.mkdirSync(areasDir, { recursive: true });

  // Create empty manifest.json
  const manifestPath = path.join(brainPath, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    const manifest: ManifestFile = { version: 1, areas: [] };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  }

  // Create .gitignore
  const gitignorePath = path.join(brainPath, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, 'kb.db\nkb.db-wal\nkb.db-shm\n');
  }

  // Git init (idempotent)
  const gitDir = path.join(brainPath, '.git');
  if (!fs.existsSync(gitDir)) {
    execSync('git init', { cwd: brainPath, stdio: 'pipe' });
  }
}

export function isDirtyShutdown(brainPath: string): boolean {
  const output = execSync('git status --porcelain', {
    cwd: brainPath,
    encoding: 'utf-8',
  }).trim();
  return output.length > 0;
}

export function recoverDirtyShutdown(brainPath: string): void {
  execSync('git add -A', { cwd: brainPath, stdio: 'pipe' });
  execSync('git commit -m "kb: recovery commit — uncommitted changes from previous session"', {
    cwd: brainPath,
    stdio: 'pipe',
  });
}
