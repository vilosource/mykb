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

  // Create .gitignore. Includes:
  //   - SQLite mirror (kb.db, kb.db-wal, kb.db-shm) — regenerated from
  //     JSONL by `kb rebuild`.
  //   - .sessions/ — per-session ephemeral state written by the Pi
  //     extension when KB_SESSION_ID is set (file-backed SessionState).
  //     Local-only, must never be committed.
  const gitignorePath = path.join(brainPath, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, 'kb.db\nkb.db-wal\nkb.db-shm\n.sessions/\n');
  } else {
    // Existing brains predate the .sessions/ entry; append it once.
    const current = fs.readFileSync(gitignorePath, 'utf-8');
    if (!current.split('\n').some((l) => l.trim() === '.sessions/')) {
      const sep = current.endsWith('\n') ? '' : '\n';
      fs.appendFileSync(gitignorePath, `${sep}.sessions/\n`);
    }
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
