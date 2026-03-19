import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const CLI_PATH = path.join(PROJECT_ROOT, 'dist', 'cli', 'cli.js');

let brainPath: string;

beforeAll(() => {
  execSync('npm run build', { cwd: PROJECT_ROOT, stdio: 'pipe' });
});

function runKb(args: string, opts?: { stdin?: string }): { stdout: string; exitCode: number } {
  try {
    const stdout = execSync(`node ${CLI_PATH} ${args}`, {
      cwd: PROJECT_ROOT,
      env: { ...process.env, MYKB_DIR: brainPath },
      encoding: 'utf-8',
      timeout: 10000,
      input: opts?.stdin,
    });
    return { stdout, exitCode: 0 };
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    return { stdout: (err.stdout || err.stderr || '').toString(), exitCode: err.status || 1 };
  }
}

beforeEach(() => {
  brainPath = fs.mkdtempSync(path.join(os.tmpdir(), 'mykb-wsa-test-'));
  runKb('init');
  runKb('work create test-ws "Test Workspace"');
  runKb('work start test-ws');
});

afterEach(() => {
  fs.rmSync(brainPath, { recursive: true, force: true });
});

describe('kb wsa CLI', () => {
  describe('add', () => {
    it('registers a file already in docs/ (register-only mode)', () => {
      const docsDir = path.join(brainPath, 'workspaces', 'test-ws', 'docs');
      fs.mkdirSync(docsDir, { recursive: true });
      fs.writeFileSync(path.join(docsDir, 'existing-PLAN.md'), '# Existing Plan');

      const { stdout, exitCode } = runKb('wsa add existing-PLAN.md');
      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/[A-Za-z0-9]{8}/); // contains ID
    });

    it('copies file from --from path into docs/ and registers', () => {
      const srcFile = path.join(brainPath, 'external.md');
      fs.writeFileSync(srcFile, '# External Doc');

      const { stdout, exitCode } = runKb(`wsa add external-DESIGN.md --from ${srcFile}`);
      expect(exitCode).toBe(0);

      const docsDir = path.join(brainPath, 'workspaces', 'test-ws', 'docs');
      expect(fs.existsSync(path.join(docsDir, 'external-DESIGN.md'))).toBe(true);
    });

    it('errors with actionable message when --from file does not exist', () => {
      const { stdout, exitCode } = runKb('wsa add doc.md --from /nonexistent/path.md');
      expect(exitCode).toBe(1);
      expect(stdout).toContain('File not found');
    });

    it('reads content from stdin and registers', () => {
      const { stdout, exitCode } = runKb('wsa add stdin-doc.md', { stdin: '# From Stdin' });
      expect(exitCode).toBe(0);

      const docsDir = path.join(brainPath, 'workspaces', 'test-ws', 'docs');
      expect(fs.readFileSync(path.join(docsDir, 'stdin-doc.md'), 'utf-8')).toBe('# From Stdin');
    });

    it('errors without active workspace', () => {
      runKb('work stop');
      const { stdout, exitCode } = runKb('wsa add doc.md', { stdin: '# Doc' });
      expect(exitCode).toBe(1);
      expect(stdout).toContain('no active workspace');
    });

    it('errors for non-.md filename', () => {
      const { stdout, exitCode } = runKb('wsa add script.sh', { stdin: '#!/bin/bash' });
      expect(exitCode).toBe(1);
      expect(stdout).toContain('.md');
    });

    it('errors for duplicate filename', () => {
      runKb('wsa add doc.md', { stdin: '# First' });
      const { stdout, exitCode } = runKb('wsa add doc.md', { stdin: '# Second' });
      expect(exitCode).toBe(1);
      expect(stdout).toContain('already exists');
    });
  });

  describe('list', () => {
    it('lists artifacts with ID, type, filename, description', () => {
      runKb('wsa add plan-PLAN.md --desc "Migration plan"', { stdin: '# Plan' });
      const { stdout, exitCode } = runKb('wsa list');
      expect(exitCode).toBe(0);
      expect(stdout).toContain('plan-PLAN.md');
      expect(stdout).toContain('plan');
      expect(stdout).toContain('Migration plan');
    });

    it('shows message when no artifacts', () => {
      const { stdout, exitCode } = runKb('wsa list');
      expect(exitCode).toBe(0);
      expect(stdout.toLowerCase()).toMatch(/no artifact/);
    });

    it('errors without active workspace', () => {
      runKb('work stop');
      const { stdout, exitCode } = runKb('wsa list');
      expect(exitCode).toBe(1);
      expect(stdout).toContain('no active workspace');
    });
  });

  describe('show', () => {
    it('prints full artifact content by ID', () => {
      const { stdout: addOut } = runKb('wsa add doc.md', { stdin: '# Full Content\nLine 2' });
      const id = addOut.trim().match(/Artifact added: ([A-Za-z0-9]+)/)?.[1];

      const { stdout, exitCode } = runKb(`wsa show ${id}`);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('# Full Content');
      expect(stdout).toContain('Line 2');
    });

    it('prints full artifact content by filename', () => {
      runKb('wsa add doc.md', { stdin: '# By Filename' });
      const { stdout, exitCode } = runKb('wsa show doc.md');
      expect(exitCode).toBe(0);
      expect(stdout).toContain('# By Filename');
    });

    it('errors for non-existent artifact with actionable message', () => {
      const { stdout, exitCode } = runKb('wsa show nonexistent');
      expect(exitCode).toBe(1);
      expect(stdout).toContain('not found');
      expect(stdout).toContain('kb wsa list');
    });
  });

  describe('meta', () => {
    it('shows all metadata fields', () => {
      runKb('wsa add doc-PLAN.md --desc "A plan" --tags t1,t2 --areas infra', { stdin: '# Plan' });
      const { stdout, exitCode } = runKb('wsa meta doc-PLAN.md');
      expect(exitCode).toBe(0);
      expect(stdout).toContain('plan');
      expect(stdout).toContain('A plan');
      expect(stdout).toContain('t1');
      expect(stdout).toContain('t2');
      expect(stdout).toContain('infra');
    });
  });

  describe('update', () => {
    it('updates description', () => {
      runKb('wsa add doc.md', { stdin: '# Doc' });
      runKb('wsa update doc.md --desc "New description"');
      const { stdout } = runKb('wsa meta doc.md');
      expect(stdout).toContain('New description');
    });

    it('updates tags', () => {
      runKb('wsa add doc.md', { stdin: '# Doc' });
      runKb('wsa update doc.md --tags new-tag,other');
      const { stdout } = runKb('wsa meta doc.md');
      expect(stdout).toContain('new-tag');
      expect(stdout).toContain('other');
    });

    it('updates areas', () => {
      runKb('wsa add doc.md', { stdin: '# Doc' });
      runKb('wsa update doc.md --areas infra,networking');
      const { stdout } = runKb('wsa meta doc.md');
      expect(stdout).toContain('infra');
      expect(stdout).toContain('networking');
    });

    it('errors for non-existent artifact', () => {
      const { stdout, exitCode } = runKb('wsa update nonexistent --desc "x"');
      expect(exitCode).toBe(1);
      expect(stdout).toContain('not found');
    });
  });

  describe('delete', () => {
    it('removes artifact from list and file from docs/', () => {
      runKb('wsa add doc.md', { stdin: '# Doomed' });
      const { exitCode } = runKb('wsa delete doc.md');
      expect(exitCode).toBe(0);

      const { stdout } = runKb('wsa list');
      expect(stdout).not.toContain('doc.md');

      const docsDir = path.join(brainPath, 'workspaces', 'test-ws', 'docs');
      expect(fs.existsSync(path.join(docsDir, 'doc.md'))).toBe(false);
    });

    it('errors for non-existent artifact', () => {
      const { stdout, exitCode } = runKb('wsa delete nonexistent');
      expect(exitCode).toBe(1);
      expect(stdout).toContain('not found');
    });
  });

  describe('sync', () => {
    it('reports untracked files in docs/', () => {
      const docsDir = path.join(brainPath, 'workspaces', 'test-ws', 'docs');
      fs.mkdirSync(docsDir, { recursive: true });
      fs.writeFileSync(path.join(docsDir, 'mystery.md'), '# Mystery');

      const { stdout, exitCode } = runKb('wsa sync');
      expect(exitCode).toBe(0);
      expect(stdout).toContain('mystery.md');
      expect(stdout.toLowerCase()).toContain('untracked');
    });

    it('reports missing files', () => {
      runKb('wsa add doc.md', { stdin: '# Doc' });
      fs.unlinkSync(path.join(brainPath, 'workspaces', 'test-ws', 'docs', 'doc.md'));

      const { stdout, exitCode } = runKb('wsa sync');
      expect(exitCode).toBe(0);
      expect(stdout).toContain('doc.md');
      expect(stdout.toLowerCase()).toContain('missing');
    });

    it('--fix registers untracked files', () => {
      const docsDir = path.join(brainPath, 'workspaces', 'test-ws', 'docs');
      fs.mkdirSync(docsDir, { recursive: true });
      fs.writeFileSync(path.join(docsDir, 'auto-PLAN.md'), '---\ndescription: Auto registered\n---\n# Auto');

      runKb('wsa sync --fix');

      const { stdout } = runKb('wsa list');
      expect(stdout).toContain('auto-PLAN.md');
    });
  });

  describe('link and unlink', () => {
    it('links artifact to area', () => {
      runKb('wsa add doc.md', { stdin: '# Doc' });
      runKb('wsa link doc.md infra');
      const { stdout } = runKb('wsa meta doc.md');
      expect(stdout).toContain('infra');
    });

    it('unlinks artifact from area', () => {
      runKb('wsa add doc.md', { stdin: '# Doc' });
      runKb('wsa link doc.md infra');
      runKb('wsa unlink doc.md infra');
      const { stdout } = runKb('wsa meta doc.md');
      expect(stdout).not.toMatch(/Areas:.*infra/);
    });
  });

  describe('search', () => {
    it('finds content match in artifact files', () => {
      runKb('wsa add doc.md', { stdin: '# Important\nFind this needle here' });
      const { stdout, exitCode } = runKb('wsa search needle');
      expect(exitCode).toBe(0);
      expect(stdout).toContain('doc.md');
      expect(stdout).toContain('needle');
    });

    it('returns empty for no matches', () => {
      runKb('wsa add doc.md', { stdin: '# Content' });
      const { stdout, exitCode } = runKb('wsa search nonexistentterm');
      expect(exitCode).toBe(0);
    });
  });
});
