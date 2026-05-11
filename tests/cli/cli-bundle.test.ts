import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const BUNDLE_DIR = path.join(PROJECT_ROOT, 'dist', 'cli-bundle');
const BUNDLE_CLI = path.join(BUNDLE_DIR, 'cli.js');

beforeAll(() => {
  execSync('npm run bundle:cli', { cwd: PROJECT_ROOT, stdio: 'pipe', timeout: 60000 });
}, 60000);

function runBundledKb(
  args: string,
  env?: Record<string, string>,
): { stdout: string; exitCode: number } {
  try {
    const stdout = execSync(`node ${BUNDLE_CLI} ${args}`, {
      cwd: PROJECT_ROOT,
      env: { ...process.env, ...env },
      encoding: 'utf-8',
      timeout: 10000,
    });
    return { stdout, exitCode: 0 };
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    return { stdout: (err.stdout || err.stderr || '').toString(), exitCode: err.status || 1 };
  }
}

describe('cli-bundle', () => {
  describe('bundle structure', () => {
    const structureTests = [
      {
        name: 'should produce dist/cli-bundle/cli.js',
        check: () => expect(fs.existsSync(BUNDLE_CLI)).toBe(true),
      },
      {
        name: 'should have shebang as first line',
        check: () => {
          const content = fs.readFileSync(BUNDLE_CLI, 'utf-8');
          expect(content.startsWith('#!/usr/bin/env node')).toBe(true);
        },
      },
      {
        name: 'should include package.json with better-sqlite3 dependency',
        check: () => {
          const pkgPath = path.join(BUNDLE_DIR, 'package.json');
          expect(fs.existsSync(pkgPath)).toBe(true);
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as {
            dependencies: Record<string, string>;
          };
          expect(pkg.dependencies['better-sqlite3']).toBeDefined();
        },
      },
      {
        name: 'should include better-sqlite3 in node_modules',
        check: () => {
          const bsqlPath = path.join(BUNDLE_DIR, 'node_modules', 'better-sqlite3');
          expect(fs.existsSync(bsqlPath)).toBe(true);
        },
      },
    ];

    for (const tt of structureTests) {
      it(tt.name, tt.check);
    }
  });

  describe('CLI commands', () => {
    let brainPath: string;

    beforeEach(() => {
      brainPath = fs.mkdtempSync(path.join(os.tmpdir(), 'mykb-bundle-test-'));
    });

    afterEach(() => {
      fs.rmSync(brainPath, { recursive: true, force: true });
    });

    const commandTests = [
      {
        name: 'should show help with --help',
        args: '--help',
        env: {},
        check: (result: { stdout: string; exitCode: number }) => {
          expect(result.exitCode).toBe(0);
          expect(result.stdout).toContain('kb');
          expect(result.stdout).toContain('init');
        },
      },
      {
        name: 'should show correct version with --version',
        args: '--version',
        env: {},
        check: (result: { stdout: string; exitCode: number }) => {
          expect(result.exitCode).toBe(0);
          const pkg = JSON.parse(
            fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf-8'),
          ) as { version: string };
          expect(result.stdout.trim()).toBe(pkg.version);
        },
      },
    ];

    for (const tt of commandTests) {
      it(tt.name, () => {
        const result = runBundledKb(tt.args, { ...tt.env, MYKB_DIR: brainPath });
        tt.check(result);
      });
    }

    it('should init brain and add a fact (proves native module works)', () => {
      const initResult = runBundledKb('init', { MYKB_DIR: brainPath });
      expect(initResult.exitCode).toBe(0);
      expect(initResult.stdout).toContain('Brain initialized');

      const addResult = runBundledKb('add fact test-area "bundled test fact"', {
        MYKB_DIR: brainPath,
      });
      expect(addResult.exitCode).toBe(0);
      expect(addResult.stdout).toContain('added fact');
    });
  });
});
