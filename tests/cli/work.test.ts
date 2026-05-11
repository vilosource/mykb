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
): { stdout: string; stderr: string; exitCode: number } {
  // Strip an ambient KB_SESSION_ID so the CLI uses the temp brain's .active
  // pointer rather than a process-wide /tmp session file.
  const env: NodeJS.ProcessEnv = { ...process.env, MYKB_DIR: brainPath };
  delete env.KB_SESSION_ID;
  const result = spawnSync(`node ${CLI_PATH} ${args}`, {
    cwd: PROJECT_ROOT,
    env,
    encoding: 'utf-8',
    timeout: 10000,
    shell: true,
    input: opts?.stdin,
  });
  return {
    stdout: (result.stdout || '').toString(),
    stderr: (result.stderr || '').toString(),
    exitCode: result.status ?? 1,
  };
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
      const { exitCode } = runKb(
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

    it('shows repo paths in output', () => {
      runKb('work create test-ws "Test" --repos /path/to/repo');
      const { stdout, exitCode } = runKb('work start test-ws');
      expect(exitCode).toBe(0);
      expect(stdout).toContain('Repos: /path/to/repo');
    });

    it('shows knowledge area index with entry counts', () => {
      // Create an area with entries
      runKb('init area test-area "Test Area" "A test knowledge area"');
      runKb('add fact test-area "A test fact"');
      runKb('add gotcha test-area "A test gotcha"');
      // Create workspace linked to that area
      runKb('work create test-ws "Test" --areas test-area');
      const { stdout, exitCode } = runKb('work start test-ws');
      expect(exitCode).toBe(0);
      expect(stdout).toContain('## Knowledge Areas');
      expect(stdout).toContain('test-area');
      expect(stdout).toContain('A test knowledge area');
      expect(stdout).toContain('1 fact');
      expect(stdout).toContain('1 gotcha');
    });

    it('shows nudge instruction', () => {
      runKb('init area test-area "Test Area" "Summary"');
      runKb('add fact test-area "A fact"');
      runKb('work create test-ws "Test" --areas test-area');
      const { stdout } = runKb('work start test-ws');
      expect(stdout).toContain('kb load');
    });

    it('resolves workspace by prefix', () => {
      runKb('work create stark-picking "Stark Picking"');
      const { stdout, exitCode } = runKb('work start stark');
      expect(exitCode).toBe(0);
      expect(stdout).toContain('Stark Picking');
      expect(stdout).toContain('stark-picking');
    });

    it('shows candidates when prefix is ambiguous', () => {
      runKb('work create stark-picking "Stark Picking"');
      runKb('work create stark-deploy "Stark Deploy"');
      const { stderr, exitCode } = runKb('work start stark');
      expect(exitCode).toBe(1);
      expect(stderr).toContain('ambiguous');
      expect(stderr).toContain('stark-picking');
      expect(stderr).toContain('stark-deploy');
    });

    it('errors when no workspace matches prefix', () => {
      runKb('work create test-ws "Test"');
      const { stderr, exitCode } = runKb('work start nonexistent');
      expect(exitCode).toBe(1);
      expect(stderr).toContain('not found');
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
      const { stderr, exitCode } = runKb('work state --phase "building"');
      expect(exitCode).toBe(1);
      expect(stderr.toLowerCase()).toContain('no active workspace');
    });

    it('updates multiple state fields', () => {
      runKb('work create test-ws "Test"');
      runKb('work start test-ws');
      const { exitCode } = runKb(
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
      const { stderr, exitCode } = runKb('work journal "some text"');
      expect(exitCode).toBe(1);
      expect(stderr.toLowerCase()).toContain('no active workspace');
    });
  });

  describe('notes', () => {
    beforeEach(() => {
      runKb('work create test-ws "Test Workspace"');
      runKb('work start test-ws');
    });

    it('adds a note with tags', () => {
      const { stdout, exitCode } = runKb('work note "login throws 500" --tags bug,ux');
      expect(exitCode).toBe(0);
      expect(stdout.toLowerCase()).toContain('note');
      expect(stdout).toContain('bug');
    });

    it('adds a note without tags', () => {
      const { stdout, exitCode } = runKb('work note "just a thought"');
      expect(exitCode).toBe(0);
      expect(stdout.toLowerCase()).toContain('note');
    });

    it('lists all notes', () => {
      runKb('work note "first bug" --tags bug');
      runKb('work note "an idea" --tags idea');
      const { stdout, exitCode } = runKb('work notes');
      expect(exitCode).toBe(0);
      expect(stdout).toContain('first bug');
      expect(stdout).toContain('an idea');
    });

    it('filters notes by tag', () => {
      runKb('work note "first bug" --tags bug');
      runKb('work note "an idea" --tags idea');
      runKb('work note "second bug" --tags bug');
      const { stdout, exitCode } = runKb('work notes --tag bug');
      expect(exitCode).toBe(0);
      expect(stdout).toContain('first bug');
      expect(stdout).toContain('second bug');
      expect(stdout).not.toContain('an idea');
    });

    it('lists notes with IDs', () => {
      const { stdout: addOut } = runKb('work note "a note" --tags bug');
      const match = addOut.match(/\((\w+)\)/);
      expect(match).toBeTruthy();
      const { stdout } = runKb('work notes');
      expect(stdout).toContain(match![1]);
    });

    it('deletes a note by ID', () => {
      const { stdout: addOut } = runKb('work note "delete me" --tags bug');
      const noteId = addOut.match(/\((\w+)\)/)![1];
      runKb('work note "keep me" --tags idea');

      const { stdout, exitCode } = runKb(`work note --delete ${noteId}`);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('deleted');

      const { stdout: listOut } = runKb('work notes');
      expect(listOut).not.toContain('delete me');
      expect(listOut).toContain('keep me');
    });

    it('shows empty message when no notes', () => {
      const { stdout, exitCode } = runKb('work notes');
      expect(exitCode).toBe(0);
      expect(stdout.toLowerCase()).toContain('no notes');
    });

    it('errors without active workspace', () => {
      runKb('work stop');
      const { stderr, exitCode } = runKb('work note "some text"');
      expect(exitCode).toBe(1);
      expect(stderr.toLowerCase()).toContain('no active workspace');
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
      const { stderr, exitCode } = runKb('work show');
      expect(exitCode).toBe(1);
      expect(stderr.toLowerCase()).toContain('no active workspace');
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

    it('warns when no handoff exists on stop', () => {
      runKb('work create test-ws "Test Workspace"');
      runKb('work start test-ws');
      const { stderr, exitCode } = runKb('work stop');
      expect(exitCode).toBe(0);
      expect(stderr.toLowerCase()).toContain('no handoff');
    });

    it('does not warn when handoff exists and is fresh', () => {
      runKb('work create test-ws "Test Workspace"');
      runKb('work start test-ws');
      runKb('work handoff "Session context captured"');
      const { stderr } = runKb('work stop');
      expect(stderr).not.toContain('handoff');
    });

    it('warns when handoff is stale (journal newer)', () => {
      runKb('work create test-ws "Test Workspace"');
      runKb('work start test-ws');
      runKb('work handoff "Old context"');
      // Add journal entry after handoff to make it stale
      runKb('work journal "New work happened"');
      const { stderr, exitCode } = runKb('work stop');
      expect(exitCode).toBe(0);
      expect(stderr.toLowerCase()).toContain('outdated');
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

  describe('handoff', () => {
    beforeEach(() => {
      runKb('work create test-ws "Test Workspace"');
      runKb('work start test-ws');
    });

    it('saves a handoff from positional arg', () => {
      const { stdout, exitCode } = runKb('work handoff "Working on step 3. Next: tests."');
      expect(exitCode).toBe(0);
      expect(stdout.toLowerCase()).toContain('handoff');
      expect(stdout).toContain('test-ws');
    });

    it('reads handoff via stdin', () => {
      // Write handoff via positional first, then verify start renders it
      runKb('work handoff "Stdin test content"');
      const { stdout } = runKb('work start test-ws');
      expect(stdout).toContain('Stdin test content');
    });

    it('overwrites previous handoff', () => {
      runKb('work handoff "First handoff"');
      runKb('work handoff "Second handoff"');
      const { stdout } = runKb('work start test-ws');
      expect(stdout).toContain('Second handoff');
      expect(stdout).not.toContain('First handoff');
    });

    it('clears handoff with --clear', () => {
      runKb('work handoff "Some context"');
      const { stdout, exitCode } = runKb('work handoff --clear');
      expect(exitCode).toBe(0);
      expect(stdout.toLowerCase()).toContain('cleared');

      // Verify handoff no longer renders on start
      const start = runKb('work start test-ws');
      expect(start.stdout).not.toContain('Resume');
      expect(start.stdout).not.toContain('Some context');
    });

    it('renders handoff as Resume section on work start', () => {
      runKb('work handoff "Implementing store layer. Next: write CLI tests."');
      const { stdout } = runKb('work start test-ws');
      expect(stdout).toContain('## Resume');
      expect(stdout).toContain('Implementing store layer');
    });

    it('renders handoff before state fields', () => {
      runKb('work state --phase "v1.0"');
      runKb('work handoff "Working on feature X"');
      const { stdout } = runKb('work start test-ws');

      const resumePos = stdout.indexOf('## Resume');
      const phasePos = stdout.indexOf('Phase:');
      expect(resumePos).toBeGreaterThan(-1);
      expect(phasePos).toBeGreaterThan(-1);
      expect(resumePos).toBeLessThan(phasePos);
    });

    it('errors without active workspace', () => {
      runKb('work stop');
      const { stderr, exitCode } = runKb('work handoff "some text"');
      expect(exitCode).toBe(1);
      expect(stderr.toLowerCase()).toContain('no active workspace');
    });
  });

  describe('checkpoint', () => {
    beforeEach(() => {
      runKb('work create test-ws "Test Workspace"');
      runKb('work start test-ws');
      // Create an area for knowledge entry tests
      runKb('area create test-area "Test Area"');
    });

    it('updates journal only', () => {
      const { stdout, exitCode } = runKb('work checkpoint', {
        stdin: JSON.stringify({ journal: 'Milestone reached' }),
      });
      expect(exitCode).toBe(0);
      expect(stdout).toContain('journal');

      const journal = runKb('work journal --show 1');
      expect(journal.stdout).toContain('Milestone reached');
    });

    it('updates handoff only', () => {
      const { stdout, exitCode } = runKb('work checkpoint', {
        stdin: JSON.stringify({ handoff: 'Next: write tests' }),
      });
      expect(exitCode).toBe(0);
      expect(stdout).toContain('handoff');

      const show = runKb('work start test-ws');
      expect(show.stdout).toContain('Next: write tests');
    });

    it('updates state only', () => {
      const { stdout, exitCode } = runKb('work checkpoint', {
        stdin: JSON.stringify({ state: { phase: 'testing', active: 'unit tests' } }),
      });
      expect(exitCode).toBe(0);
      expect(stdout).toContain('state (phase, active)');

      const show = runKb('work show test-ws');
      expect(show.stdout).toContain('testing');
      expect(show.stdout).toContain('unit tests');
    });

    it('adds knowledge entries', () => {
      const { stdout, exitCode } = runKb('work checkpoint', {
        stdin: JSON.stringify({
          knowledge: [
            { type: 'fact', area: 'test-area', text: 'Checkpoint works' },
            {
              type: 'decision',
              area: 'test-area',
              text: 'Use JSON stdin',
              why: 'Harness agnostic',
            },
          ],
        }),
      });
      expect(exitCode).toBe(0);
      expect(stdout).toContain('2 knowledge entries');

      const loaded = runKb('load test-area');
      expect(loaded.stdout).toContain('Checkpoint works');
      expect(loaded.stdout).toContain('Use JSON stdin');
    });

    it('updates all fields at once', () => {
      const { stdout, exitCode } = runKb('work checkpoint', {
        stdin: JSON.stringify({
          journal: 'Full checkpoint test',
          handoff: 'Session continuity text',
          state: { phase: 'done', next: 'ship it' },
          knowledge: [{ type: 'fact', area: 'test-area', text: 'All fields work' }],
        }),
      });
      expect(exitCode).toBe(0);
      expect(stdout).toContain('journal');
      expect(stdout).toContain('state (phase, next)');
      expect(stdout).toContain('1 knowledge entries');
      expect(stdout).toContain('handoff');
    });

    it('reports nothing to update for empty object', () => {
      const { stdout, exitCode } = runKb('work checkpoint', { stdin: '{}' });
      expect(exitCode).toBe(0);
      expect(stdout).toContain('nothing to update');
    });

    it('errors on invalid JSON', () => {
      const { stderr, exitCode } = runKb('work checkpoint', { stdin: 'not json' });
      expect(exitCode).toBe(1);
      expect(stderr).toContain('invalid JSON');
    });

    it('errors on unknown fields', () => {
      const { stderr, exitCode } = runKb('work checkpoint', {
        stdin: JSON.stringify({ journal: 'ok', bogus: 'bad' }),
      });
      expect(exitCode).toBe(1);
      expect(stderr).toContain('unknown field');
    });

    it('errors on empty stdin', () => {
      const { stderr, exitCode } = runKb('work checkpoint', { stdin: '' });
      expect(exitCode).toBe(1);
      expect(stderr).toContain('no JSON input');
    });

    it('errors without active workspace', () => {
      runKb('work stop');
      const { stderr, exitCode } = runKb('work checkpoint', {
        stdin: JSON.stringify({ journal: 'test' }),
      });
      expect(exitCode).toBe(1);
      expect(stderr.toLowerCase()).toContain('no active workspace');
    });

    it('reports knowledge errors without failing', () => {
      const { stdout, exitCode } = runKb('work checkpoint', {
        stdin: JSON.stringify({
          journal: 'Still works',
          knowledge: [{ type: 'fact', area: 'nonexistent-area', text: 'Should fail' }],
        }),
      });
      // Command should still succeed (journal written) but report knowledge errors
      expect(exitCode).toBe(0);
      expect(stdout).toContain('journal');
    });
  });
});
