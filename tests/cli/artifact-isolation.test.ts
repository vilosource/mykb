import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { exec, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const CLI_PATH = path.join(PROJECT_ROOT, 'dist', 'cli', 'cli.js');

let brainPath: string;

beforeAll(() => {
  execSync('npm run build', { cwd: PROJECT_ROOT, stdio: 'pipe' });
});

// Pin the spawned CLI's tmpdir to brainPath so session files (which the
// production code writes to os.tmpdir() via TMPDIR/TEMP/TMP) land inside
// this test's per-test directory. Without this, parallel test files that
// all use os.tmpdir() race on each other's afterEach cleanup of
// .mykb-session-* files.
function envForChild(extra: Record<string, string> = {}): Record<string, string> {
  return {
    ...(process.env as Record<string, string>),
    MYKB_DIR: brainPath,
    TMPDIR: brainPath,
    TMP: brainPath,
    TEMP: brainPath,
    ...extra,
  };
}

function runKb(
  args: string,
  opts?: { stdin?: string; sessionId?: string },
): { stdout: string; exitCode: number } {
  const env = envForChild(opts?.sessionId ? { KB_SESSION_ID: opts.sessionId } : {});
  try {
    const stdout = execSync(`node ${CLI_PATH} ${args}`, {
      cwd: PROJECT_ROOT,
      env,
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

function runKbAsync(
  args: string,
  opts?: { stdin?: string; sessionId?: string },
): Promise<{ stdout: string; exitCode: number }> {
  return new Promise((resolve) => {
    const env = envForChild(opts?.sessionId ? { KB_SESSION_ID: opts.sessionId } : {});
    const child = exec(
      `node ${CLI_PATH} ${args}`,
      {
        cwd: PROJECT_ROOT,
        env,
        encoding: 'utf-8',
        timeout: 10000,
      },
      (error, stdout, stderr) => {
        resolve({
          stdout: (stdout || stderr || '').toString(),
          exitCode: error ? ((error as { code?: number }).code ?? 1) : 0,
        });
      },
    );
    if (opts?.stdin) {
      child.stdin?.write(opts.stdin);
      child.stdin?.end();
    }
  });
}

beforeEach(() => {
  brainPath = fs.mkdtempSync(path.join(os.tmpdir(), 'mykb-artifact-iso-'));
  runKb('init');
  runKb('work create test-ws "Test Workspace"');
  runKb('work start test-ws');
});

afterEach(() => {
  // brainPath now also contains any session files (TMPDIR override).
  // No need for unscoped tmpdir sweep — that caused cross-file races.
  fs.rmSync(brainPath, { recursive: true, force: true });
});

describe('Artifact Isolation E2E', () => {
  it('two processes add artifacts concurrently — both present, no data loss', async () => {
    const sessionA = `test-${randomUUID()}`;
    const sessionB = `test-${randomUUID()}`;

    // Both sessions start the same workspace
    runKb('work start test-ws', { sessionId: sessionA });
    runKb('work start test-ws', { sessionId: sessionB });

    // Launch two adds concurrently
    const [resultA, resultB] = await Promise.all([
      runKbAsync('wsa add alpha-PLAN.md', { stdin: '# Alpha Plan', sessionId: sessionA }),
      runKbAsync('wsa add beta-DESIGN.md', { stdin: '# Beta Design', sessionId: sessionB }),
    ]);

    expect(resultA.exitCode).toBe(0);
    expect(resultB.exitCode).toBe(0);

    // Both artifacts should be present
    const { stdout } = runKb('wsa list');
    expect(stdout).toContain('alpha-PLAN.md');
    expect(stdout).toContain('beta-DESIGN.md');

    // Verify JSONL is not corrupted — each line must parse
    const jsonlPath = path.join(brainPath, 'workspaces', 'test-ws', 'artifacts.jsonl');
    const lines = fs.readFileSync(jsonlPath, 'utf-8').trim().split('\n');
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it('one process adds while another lists — list returns consistent results', async () => {
    // Pre-add an artifact so list has something
    runKb('wsa add existing.md', { stdin: '# Existing' });

    const sessionA = `test-${randomUUID()}`;
    const sessionB = `test-${randomUUID()}`;
    runKb('work start test-ws', { sessionId: sessionA });
    runKb('work start test-ws', { sessionId: sessionB });

    const [addResult, listResult] = await Promise.all([
      runKbAsync('wsa add new-PLAN.md', { stdin: '# New Plan', sessionId: sessionA }),
      runKbAsync('wsa list', { sessionId: sessionB }),
    ]);

    expect(addResult.exitCode).toBe(0);
    expect(listResult.exitCode).toBe(0);

    // List should return valid output (no partial lines, no crash)
    // It may or may not include the new artifact depending on timing
    expect(listResult.stdout).toContain('existing.md');
  });

  it('two processes add same filename concurrently — one succeeds, one fails, no corrupt state', async () => {
    const sessionA = `test-${randomUUID()}`;
    const sessionB = `test-${randomUUID()}`;
    runKb('work start test-ws', { sessionId: sessionA });
    runKb('work start test-ws', { sessionId: sessionB });

    const [resultA, resultB] = await Promise.all([
      runKbAsync('wsa add conflict.md', { stdin: '# Version A', sessionId: sessionA }),
      runKbAsync('wsa add conflict.md', { stdin: '# Version B', sessionId: sessionB }),
    ]);

    // At least one should succeed (the other may fail on the claim file)
    const successes = [resultA, resultB].filter((r) => r.exitCode === 0);
    expect(successes.length).toBeGreaterThanOrEqual(1);

    // Final state should be consistent — exactly one artifact with that filename
    const { stdout } = runKb('wsa list');
    const matches = stdout.split('\n').filter((l) => l.includes('conflict.md'));
    expect(matches.length).toBe(1);

    // JSONL should not be corrupted
    const jsonlPath = path.join(brainPath, 'workspaces', 'test-ws', 'artifacts.jsonl');
    const lines = fs.readFileSync(jsonlPath, 'utf-8').trim().split('\n');
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it('concurrent add + delete of different artifacts — final state is consistent', async () => {
    // Pre-add an artifact to delete
    runKb('wsa add doomed.md', { stdin: '# Doomed' });

    const sessionA = `test-${randomUUID()}`;
    const sessionB = `test-${randomUUID()}`;
    runKb('work start test-ws', { sessionId: sessionA });
    runKb('work start test-ws', { sessionId: sessionB });

    const [addResult, deleteResult] = await Promise.all([
      runKbAsync('wsa add survivor-PLAN.md', { stdin: '# Survivor', sessionId: sessionA }),
      runKbAsync('wsa delete doomed.md', { sessionId: sessionB }),
    ]);

    expect(addResult.exitCode).toBe(0);
    expect(deleteResult.exitCode).toBe(0);

    // Final list: survivor present, doomed gone
    const { stdout } = runKb('wsa list');
    expect(stdout).toContain('survivor-PLAN.md');
    expect(stdout).not.toContain('doomed.md');
  });

  it('concurrent sync --fix from two processes — no duplicate registrations', async () => {
    // Create untracked files manually
    const docsDir = path.join(brainPath, 'workspaces', 'test-ws', 'docs');
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(path.join(docsDir, 'untracked-one.md'), '# One');
    fs.writeFileSync(path.join(docsDir, 'untracked-two.md'), '# Two');

    const sessionA = `test-${randomUUID()}`;
    const sessionB = `test-${randomUUID()}`;
    runKb('work start test-ws', { sessionId: sessionA });
    runKb('work start test-ws', { sessionId: sessionB });

    // Both try to sync --fix at the same time
    const [syncA, syncB] = await Promise.all([
      runKbAsync('wsa sync --fix', { sessionId: sessionA }),
      runKbAsync('wsa sync --fix', { sessionId: sessionB }),
    ]);

    // At least one should succeed
    expect([syncA.exitCode, syncB.exitCode]).toContain(0);

    // Final list should have no duplicate filenames
    const { stdout } = runKb('wsa list');
    const filenames = stdout
      .split('\n')
      .filter((l) => l.includes('.md'))
      .map((l) => l.match(/\S+\.md/)?.[0])
      .filter(Boolean);
    const unique = new Set(filenames);
    expect(filenames.length).toBe(unique.size);
  });
});
