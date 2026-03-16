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

function runKb(args: string): { stdout: string; exitCode: number } {
  try {
    const stdout = execSync(`node ${CLI_PATH} ${args}`, {
      cwd: PROJECT_ROOT,
      env: { ...process.env, MYKB_DIR: brainPath },
      encoding: 'utf-8',
      timeout: 10000,
    });
    return { stdout, exitCode: 0 };
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    return { stdout: (err.stdout || err.stderr || '').toString(), exitCode: err.status || 1 };
  }
}

beforeEach(() => {
  brainPath = fs.mkdtempSync(path.join(os.tmpdir(), 'mykb-work-test-'));
  runKb('init');
});

afterEach(() => {
  fs.rmSync(brainPath, { recursive: true, force: true });
});

describe('kb work CLI', () => {
  describe('create', () => {
    it('creates a workspace', () => {
      const { stdout, exitCode } = runKb('work create test-ws "Test Workspace"');
      expect(exitCode).toBe(0);
      expect(stdout).toContain('test-ws');
      expect(stdout.toLowerCase()).toContain('created');
    });

    it('creates a workspace with areas', () => {
      const { stdout, exitCode } = runKb('work create test-ws "Test" --areas net,ci');
      expect(exitCode).toBe(0);
      expect(stdout).toContain('test-ws');
      // Verify areas are linked
      const show = runKb('work show test-ws');
      expect(show.stdout).toContain('net');
      expect(show.stdout).toContain('ci');
    });

    it('creates a workspace with jira and wiki links', () => {
      const { stdout, exitCode } = runKb(
        'work create test-ws "Test" --jira PROJ-123 --wiki https://wiki.example.com',
      );
      expect(exitCode).toBe(0);
      const show = runKb('work show test-ws');
      expect(show.stdout).toContain('PROJ-123');
      expect(show.stdout).toContain('https://wiki.example.com');
    });
  });

  describe('start', () => {
    it('sets active workspace and shows state', () => {
      runKb('work create test-ws "Test Workspace"');
      const { stdout, exitCode } = runKb('work start test-ws');
      expect(exitCode).toBe(0);
      expect(stdout).toContain('Test Workspace');
      expect(stdout).toContain('test-ws');
    });
  });

  describe('state', () => {
    it('updates workspace state', () => {
      runKb('work create test-ws "Test Workspace"');
      runKb('work start test-ws');
      const { stdout, exitCode } = runKb('work state --phase "building"');
      expect(exitCode).toBe(0);
      expect(stdout.toLowerCase()).toContain('updated');
      // Verify state was set
      const show = runKb('work show');
      expect(show.stdout).toContain('building');
    });

    it('errors without active workspace', () => {
      const { stdout, exitCode } = runKb('work state --phase "building"');
      expect(exitCode).toBe(1);
      expect(stdout.toLowerCase()).toContain('no active workspace');
    });

    it('updates multiple state fields', () => {
      runKb('work create test-ws "Test"');
      runKb('work start test-ws');
      const { stdout, exitCode } = runKb(
        'work state --phase "building" --active "implementing CLI" --next "write tests"',
      );
      expect(exitCode).toBe(0);
      const show = runKb('work show');
      expect(show.stdout).toContain('building');
      expect(show.stdout).toContain('implementing CLI');
      expect(show.stdout).toContain('write tests');
    });
  });

  describe('journal', () => {
    beforeEach(() => {
      runKb('work create test-ws "Test Workspace"');
      runKb('work start test-ws');
    });

    it('appends a journal entry', () => {
      const { stdout, exitCode } = runKb('work journal "did work"');
      expect(exitCode).toBe(0);
      expect(stdout.toLowerCase()).toContain('journal');
    });

    it('shows journal entries', () => {
      runKb('work journal "first entry"');
      runKb('work journal "second entry"');
      runKb('work journal "third entry"');
      const { stdout, exitCode } = runKb('work journal --show 3');
      expect(exitCode).toBe(0);
      expect(stdout).toContain('first entry');
      expect(stdout).toContain('second entry');
      expect(stdout).toContain('third entry');
    });

    it('errors without active workspace', () => {
      runKb('work stop');
      const { stdout, exitCode } = runKb('work journal "some text"');
      expect(exitCode).toBe(1);
      expect(stdout.toLowerCase()).toContain('no active workspace');
    });
  });

  describe('link and unlink', () => {
    beforeEach(() => {
      runKb('work create test-ws "Test" --areas net');
      runKb('work start test-ws');
    });

    it('links an area', () => {
      const { stdout, exitCode } = runKb('work link newarea');
      expect(exitCode).toBe(0);
      expect(stdout.toLowerCase()).toContain('linked');
      const show = runKb('work show');
      expect(show.stdout).toContain('newarea');
    });

    it('unlinks an area', () => {
      const { stdout, exitCode } = runKb('work unlink net');
      expect(exitCode).toBe(0);
      expect(stdout.toLowerCase()).toContain('unlinked');
      const show = runKb('work show');
      expect(show.stdout).not.toContain('net');
    });
  });

  describe('list', () => {
    it('lists workspaces', () => {
      runKb('work create ws1 "Workspace One"');
      runKb('work create ws2 "Workspace Two"');
      const { stdout, exitCode } = runKb('work list');
      expect(exitCode).toBe(0);
      expect(stdout).toContain('ws1');
      expect(stdout).toContain('ws2');
    });

    it('shows empty message when no workspaces', () => {
      const { stdout, exitCode } = runKb('work list');
      expect(exitCode).toBe(0);
      expect(stdout.toLowerCase()).toContain('no workspace');
    });
  });

  describe('show', () => {
    it('shows active workspace', () => {
      runKb('work create test-ws "Test Workspace"');
      runKb('work start test-ws');
      const { stdout, exitCode } = runKb('work show');
      expect(exitCode).toBe(0);
      expect(stdout).toContain('Test Workspace');
      expect(stdout).toContain('test-ws');
    });

    it('shows specific workspace by id', () => {
      runKb('work create test-ws "Test Workspace"');
      const { stdout, exitCode } = runKb('work show test-ws');
      expect(exitCode).toBe(0);
      expect(stdout).toContain('Test Workspace');
    });

    it('errors when no active workspace and no id given', () => {
      const { stdout, exitCode } = runKb('work show');
      expect(exitCode).toBe(1);
      expect(stdout.toLowerCase()).toContain('no active workspace');
    });
  });

  describe('stop', () => {
    it('clears active workspace', () => {
      runKb('work create test-ws "Test Workspace"');
      runKb('work start test-ws');
      const { stdout, exitCode } = runKb('work stop');
      expect(exitCode).toBe(0);
      expect(stdout.toLowerCase()).toContain('stopped');
      // Verify no active workspace
      const show = runKb('work show');
      expect(show.exitCode).toBe(1);
    });
  });

  describe('archive', () => {
    it('archives a workspace', () => {
      runKb('work create test-ws "Test Workspace"');
      const { stdout, exitCode } = runKb('work archive test-ws');
      expect(exitCode).toBe(0);
      expect(stdout.toLowerCase()).toContain('archived');
      // Should not appear in list
      const list = runKb('work list');
      expect(list.stdout).not.toContain('test-ws');
    });

    it('clears active if archived workspace was active', () => {
      runKb('work create test-ws "Test Workspace"');
      runKb('work start test-ws');
      runKb('work archive test-ws');
      const show = runKb('work show');
      expect(show.exitCode).toBe(1);
    });
  });
});
