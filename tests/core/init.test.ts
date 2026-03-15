import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { withTempBrain } from '../helpers.js';
import { initBrain, isDirtyShutdown, recoverDirtyShutdown } from '../../src/core/init.js';

describe('initBrain', () => {
  it('creates brain directory structure', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);

      expect(fs.existsSync(brainPath)).toBe(true);
      expect(fs.existsSync(path.join(brainPath, 'areas'))).toBe(true);
      expect(fs.existsSync(path.join(brainPath, 'manifest.json'))).toBe(true);
    });
  });

  it('creates .gitignore with kb.db', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);

      const gitignorePath = path.join(brainPath, '.gitignore');
      expect(fs.existsSync(gitignorePath)).toBe(true);
      const content = fs.readFileSync(gitignorePath, 'utf-8');
      expect(content).toContain('kb.db');
    });
  });

  it('initializes a git repository', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);

      const gitDir = path.join(brainPath, '.git');
      expect(fs.existsSync(gitDir)).toBe(true);
    });
  });

  it('creates empty manifest.json', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);

      const manifest = JSON.parse(
        fs.readFileSync(path.join(brainPath, 'manifest.json'), 'utf-8'),
      ) as { version: number; areas: unknown[] };
      expect(manifest.version).toBe(1);
      expect(manifest.areas).toEqual([]);
    });
  });

  it('is idempotent — calling twice does not error', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);
      expect(() => initBrain(brainPath)).not.toThrow();
    });
  });
});

describe('isDirtyShutdown', () => {
  it('returns false for clean repo', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);
      // Git add and commit initial files
      execSync('git add -A && git commit -m "init"', { cwd: brainPath });

      expect(isDirtyShutdown(brainPath)).toBe(false);
    });
  });

  it('returns true when there are uncommitted changes', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);
      execSync('git add -A && git commit -m "init"', { cwd: brainPath });

      // Create an uncommitted file
      fs.writeFileSync(path.join(brainPath, 'dirty.txt'), 'uncommitted');

      expect(isDirtyShutdown(brainPath)).toBe(true);
    });
  });
});

describe('recoverDirtyShutdown', () => {
  it('commits uncommitted changes with recovery message', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);
      execSync('git add -A && git commit -m "init"', { cwd: brainPath });

      // Create dirty state
      fs.writeFileSync(path.join(brainPath, 'dirty.txt'), 'uncommitted');

      recoverDirtyShutdown(brainPath);

      expect(isDirtyShutdown(brainPath)).toBe(false);

      // Verify commit message
      const log = execSync('git log --oneline -1', { cwd: brainPath, encoding: 'utf-8' });
      expect(log).toContain('kb: recovery commit');
    });
  });
});
