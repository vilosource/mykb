import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { withTempBrain } from '../helpers.js';
import { initBrain } from '../../src/core/init.js';
import { save } from '../../src/core/save.js';

function setupBrain(brainPath: string): void {
  initBrain(brainPath);
  execSync('git add -A && git commit -m "init"', { cwd: brainPath, stdio: 'pipe' });
}

describe('save', () => {
  it('commits all changes with auto-generated message', async () => {
    await withTempBrain(async (brainPath) => {
      setupBrain(brainPath);

      fs.writeFileSync(path.join(brainPath, 'test.txt'), 'hello');

      save(brainPath);

      const log = execSync('git log --oneline -1', { cwd: brainPath, encoding: 'utf-8' });
      expect(log).toContain('kb: save');

      // Working tree should be clean
      const status = execSync('git status --porcelain', {
        cwd: brainPath,
        encoding: 'utf-8',
      }).trim();
      expect(status).toBe('');
    });
  });

  it('commits with custom message', async () => {
    await withTempBrain(async (brainPath) => {
      setupBrain(brainPath);

      fs.writeFileSync(path.join(brainPath, 'test.txt'), 'hello');

      save(brainPath, 'added test file');

      const log = execSync('git log --oneline -1', { cwd: brainPath, encoding: 'utf-8' });
      expect(log).toContain('added test file');
    });
  });

  it('does not fail when there are no changes', async () => {
    await withTempBrain(async (brainPath) => {
      setupBrain(brainPath);

      // No changes to commit — should not throw
      expect(() => save(brainPath)).not.toThrow();
    });
  });
});
