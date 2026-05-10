import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
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

/**
 * Run kb CLI with optional KB_SESSION_ID for session isolation testing.
 * When sessionId is provided, it simulates a session-isolated launch.
 * When omitted, it simulates plain `kb` on the host (no isolation).
 */
function runKb(
  args: string,
  sessionId?: string,
): { stdout: string; exitCode: number } {
  // Pin the child's tmpdir to brainPath so session files (which the
  // production code writes to os.tmpdir() based on TMPDIR/TEMP/TMP)
  // land inside this test's per-test directory. Without this, parallel
  // test files that all use os.tmpdir() race on each other's afterEach
  // cleanup of .mykb-session-* files.
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    MYKB_DIR: brainPath,
    TMPDIR: brainPath,
    TMP: brainPath,
    TEMP: brainPath,
  };
  if (sessionId) {
    env.KB_SESSION_ID = sessionId;
  } else {
    delete env.KB_SESSION_ID;
  }
  try {
    const stdout = execSync(`node ${CLI_PATH} ${args}`, {
      cwd: PROJECT_ROOT,
      env,
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
  brainPath = fs.mkdtempSync(path.join(os.tmpdir(), 'mykb-session-iso-'));
  runKb('init');
  // Create two workspaces for testing
  runKb('work create ws-alpha "Alpha Workspace"');
  runKb('work create ws-beta "Beta Workspace"');
});

afterEach(() => {
  // brainPath now also contains any session files (TMPDIR override).
  // No need for unscoped tmpdir sweep — that caused cross-file races.
  fs.rmSync(brainPath, { recursive: true, force: true });
});

describe('Session Isolation E2E (KB_SESSION_ID)', () => {
  it('two sessions start different workspaces without clobbering each other', () => {
    const sessionA = `test-${randomUUID()}`;
    const sessionB = `test-${randomUUID()}`;

    // Session A starts ws-alpha
    const startA = runKb('work start ws-alpha', sessionA);
    expect(startA.exitCode).toBe(0);
    expect(startA.stdout).toContain('Alpha Workspace');

    // Session B starts ws-beta
    const startB = runKb('work start ws-beta', sessionB);
    expect(startB.exitCode).toBe(0);
    expect(startB.stdout).toContain('Beta Workspace');

    // Session A still sees ws-alpha
    const showA = runKb('work show', sessionA);
    expect(showA.exitCode).toBe(0);
    expect(showA.stdout).toContain('Alpha Workspace');

    // Session B still sees ws-beta
    const showB = runKb('work show', sessionB);
    expect(showB.exitCode).toBe(0);
    expect(showB.stdout).toContain('Beta Workspace');
  });

  it('session journal entries go to the correct workspace', () => {
    const sessionA = `test-${randomUUID()}`;
    const sessionB = `test-${randomUUID()}`;

    // Start workspaces in separate sessions
    runKb('work start ws-alpha', sessionA);
    runKb('work start ws-beta', sessionB);

    // Journal from session A
    const journalA = runKb('work journal "alpha progress note"', sessionA);
    expect(journalA.exitCode).toBe(0);

    // Journal from session B
    const journalB = runKb('work journal "beta progress note"', sessionB);
    expect(journalB.exitCode).toBe(0);

    // Verify journal entries are in the correct workspaces
    const showAlpha = runKb('work journal --show 5', sessionA);
    expect(showAlpha.stdout).toContain('alpha progress note');
    expect(showAlpha.stdout).not.toContain('beta progress note');

    const showBeta = runKb('work journal --show 5', sessionB);
    expect(showBeta.stdout).toContain('beta progress note');
    expect(showBeta.stdout).not.toContain('alpha progress note');
  });

  it('session state updates go to the correct workspace', () => {
    const sessionA = `test-${randomUUID()}`;
    const sessionB = `test-${randomUUID()}`;

    runKb('work start ws-alpha', sessionA);
    runKb('work start ws-beta', sessionB);

    // Update state from each session
    runKb('work state --phase "alpha-phase"', sessionA);
    runKb('work state --phase "beta-phase"', sessionB);

    // Each session sees its own state
    const showA = runKb('work show', sessionA);
    expect(showA.stdout).toContain('alpha-phase');
    expect(showA.stdout).not.toContain('beta-phase');

    const showB = runKb('work show', sessionB);
    expect(showB.stdout).toContain('beta-phase');
    expect(showB.stdout).not.toContain('alpha-phase');
  });

  it('session does not touch .active file', () => {
    const session = `test-${randomUUID()}`;
    const activeFile = path.join(brainPath, 'workspaces', '.active');

    // Pre-set .active to a known value
    runKb('work start ws-alpha'); // sets .active (no session ID)
    expect(fs.existsSync(activeFile)).toBe(true);
    expect(fs.readFileSync(activeFile, 'utf-8').trim()).toBe('ws-alpha');

    // Start a different workspace in a session
    runKb('work start ws-beta', session);

    // .active should be unchanged
    expect(fs.readFileSync(activeFile, 'utf-8').trim()).toBe('ws-alpha');

    // The session sees ws-beta, not ws-alpha
    const show = runKb('work show', session);
    expect(show.stdout).toContain('Beta Workspace');
  });

  it('session stop clears session file, .active unchanged', () => {
    const session = `test-${randomUUID()}`;
    const activeFile = path.join(brainPath, 'workspaces', '.active');
    // Session file lands inside brainPath because runKb pins TMPDIR there.
    const sessionFile = path.join(brainPath, `.mykb-session-${session}`);

    // Set .active via non-session command
    runKb('work start ws-alpha');
    expect(fs.readFileSync(activeFile, 'utf-8').trim()).toBe('ws-alpha');

    // Start ws-beta in session
    runKb('work start ws-beta', session);
    expect(fs.existsSync(sessionFile)).toBe(true);

    // Stop from session
    runKb('work stop', session);
    expect(fs.existsSync(sessionFile)).toBe(false);

    // .active still has ws-alpha
    expect(fs.readFileSync(activeFile, 'utf-8').trim()).toBe('ws-alpha');
  });

  it('no KB_SESSION_ID falls back to .active (backward compatibility)', () => {
    // No session ID — uses .active as before
    runKb('work start ws-alpha');

    const show = runKb('work show');
    expect(show.exitCode).toBe(0);
    expect(show.stdout).toContain('Alpha Workspace');

    // Switch to ws-beta — overwrites .active
    runKb('work start ws-beta');
    const show2 = runKb('work show');
    expect(show2.stdout).toContain('Beta Workspace');
  });

  it('session with no workspace started returns error on workspace commands', () => {
    const session = `test-${randomUUID()}`;

    // Session exists but hasn't started a workspace
    const show = runKb('work show', session);
    expect(show.exitCode).toBe(1);
    expect(show.stdout.toLowerCase()).toContain('no active workspace');

    const journal = runKb('work journal "orphan entry"', session);
    expect(journal.exitCode).toBe(1);
  });
});
