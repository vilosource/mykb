import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const CLI_PATH = path.join(PROJECT_ROOT, 'dist', 'cli', 'cli.js');

let brainPath: string;

beforeAll(() => {
  execSync('npm run build', { cwd: PROJECT_ROOT, stdio: 'pipe' });
});

function runKb(
  args: string,
  opts?: { stdin?: string },
): {
  stdout: string;
  stderr: string;
  exitCode: number;
} {
  const env: NodeJS.ProcessEnv = { ...process.env, MYKB_DIR: brainPath };
  delete env.KB_SESSION_ID;
  const result = spawnSync(`node ${CLI_PATH} ${args}`, {
    cwd: PROJECT_ROOT,
    env,
    encoding: 'utf-8',
    timeout: 15000,
    shell: true,
    input: opts?.stdin,
  });
  return {
    stdout: (result.stdout || '').toString(),
    stderr: (result.stderr || '').toString(),
    exitCode: result.status ?? 1,
  };
}

/** Append a journal entry with a controlled timestamp (the CLI always stamps "now"). */
function writeJournalEntry(wsId: string, date: string, text: string): void {
  const file = path.join(brainPath, 'workspaces', wsId, 'journal.jsonl');
  fs.appendFileSync(file, JSON.stringify({ date, text }) + '\n');
}

function isoDaysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

/** `kb work create` stamps `updated` = now; backdate it so window tests are meaningful. */
function setWorkspaceUpdated(wsId: string, iso: string): void {
  const f = path.join(brainPath, 'workspaces', wsId, 'workspace.json');
  const ws = JSON.parse(fs.readFileSync(f, 'utf-8'));
  ws.updated = iso;
  fs.writeFileSync(f, JSON.stringify(ws, null, 2) + '\n');
}

beforeEach(() => {
  brainPath = fs.mkdtempSync(path.join(os.tmpdir(), 'mykb-recent-cli-test-'));
  runKb('init');
});

afterEach(() => {
  fs.rmSync(brainPath, { recursive: true, force: true });
});

describe('kb recent', () => {
  it('lists recently-worked workspaces with phase, an entry count, and a journal one-liner; marks the active one', () => {
    runKb('work create alpha "Alpha workspace"');
    runKb('work start alpha');
    runKb('work state --phase "building alpha"');
    runKb('work journal "shipped the alpha thing"');
    runKb('work create bravo "Bravo workspace"');
    runKb('work start bravo');
    runKb('work journal "started on bravo"');

    const r = runKb('recent');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('WORKSPACES');
    expect(r.stdout).toContain('alpha');
    expect(r.stdout).toContain('bravo');
    expect(r.stdout).toContain('building alpha');
    expect(r.stdout).toContain('shipped the alpha thing');
    expect(r.stdout).toContain('started on bravo');
    // bravo is the active workspace → it gets the "*" marker.
    expect(r.stdout).toMatch(/\*\s+bravo/);
    expect(r.stdout).not.toMatch(/\*\s+alpha/);
  });

  it('--json emits the structured digest', () => {
    runKb('work create w1 "W1"');
    runKb('work start w1');
    runKb('work journal "did a thing"');

    const r = runKb('recent --json');
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.all).toBe(false);
    expect(typeof parsed.since).toBe('string');
    expect(Array.isArray(parsed.workspaces)).toBe(true);
    expect(parsed.workspaces.map((w: { id: string }) => w.id)).toContain('w1');
    expect(Array.isArray(parsed.areas)).toBe(true);
  });

  it('-d N controls the window; --all ignores it', () => {
    runKb('work create old "Old"');
    runKb('work create fresh "Fresh"');
    // The CLI stamps `updated` = now on create, so backdate "old" and write its
    // journal entry ten days back; "fresh" stays at "now".
    setWorkspaceUpdated('old', isoDaysAgo(10));
    writeJournalEntry('old', isoDaysAgo(10), 'a milestone ten days ago');
    writeJournalEntry('fresh', isoDaysAgo(0), 'a milestone today');

    const twoDays = runKb('recent -d 2');
    expect(twoDays.exitCode).toBe(0);
    expect(twoDays.stdout).toContain('fresh');
    expect(twoDays.stdout).not.toContain('a milestone ten days ago');

    const thirtyDays = runKb('recent -d 30');
    expect(thirtyDays.stdout).toContain('old');
    expect(thirtyDays.stdout).toContain('a milestone ten days ago');

    const all = runKb('recent --all');
    expect(all.exitCode).toBe(0);
    expect(all.stdout).toContain('all (no time window)');
    expect(all.stdout).toContain('old');
    expect(all.stdout).toContain('fresh');
  });

  it('--git: on a non-git brain prints a note and still exits 0', () => {
    const r = runKb('recent --git');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('GIT LOG');
    expect(r.stdout).toContain('not a git repo');
  });

  it('--git: on a git brain includes commit subjects from the window', () => {
    execSync('git init -q', { cwd: brainPath });
    execSync('git -c user.email=t@example.com -c user.name=Tester add -A', { cwd: brainPath });
    execSync(
      'git -c user.email=t@example.com -c user.name=Tester commit -q -m "RECENT_TEST_COMMIT_SUBJECT"',
      {
        cwd: brainPath,
      },
    );

    const r = runKb('recent --git -d 30');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('GIT LOG');
    expect(r.stdout).toContain('RECENT_TEST_COMMIT_SUBJECT');
  });

  it('prints a "(no recent activity)" note for a brain with nothing recent', () => {
    const r = runKb('recent');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('no recent activity');
  });

  it('rejects a non-positive or non-numeric --days', () => {
    const zero = runKb('recent -d 0');
    expect(zero.exitCode).not.toBe(0);
    expect(zero.stderr).toContain('positive integer');

    const nan = runKb('recent -d abc');
    expect(nan.exitCode).not.toBe(0);
    expect(nan.stderr).toContain('positive integer');
  });

  it('exits non-zero when MYKB_DIR points at a path that does not exist', () => {
    const missing = path.join(os.tmpdir(), `mykb-no-such-brain-${Date.now()}-${process.pid}`);
    const env: NodeJS.ProcessEnv = { ...process.env, MYKB_DIR: missing };
    delete env.KB_SESSION_ID;
    const result = spawnSync(`node ${CLI_PATH} recent`, {
      cwd: PROJECT_ROOT,
      env,
      encoding: 'utf-8',
      timeout: 15000,
      shell: true,
    });
    expect(result.status ?? 1).not.toBe(0);
    expect((result.stderr || '').toString()).toContain('brain not initialized');
  });
});
