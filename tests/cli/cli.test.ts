import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const CLI_PATH = path.join(PROJECT_ROOT, 'dist', 'cli', 'cli.js');

let brainPath: string;

beforeAll(() => {
  // Build the CLI before running tests
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
  brainPath = fs.mkdtempSync(path.join(os.tmpdir(), 'mykb-cli-test-'));
});

afterEach(() => {
  fs.rmSync(brainPath, { recursive: true, force: true });
});

describe('kb CLI', () => {
  describe('help', () => {
    it('shows help with --help', () => {
      const { stdout, exitCode } = runKb('--help');
      expect(exitCode).toBe(0);
      expect(stdout).toContain('kb');
      expect(stdout).toContain('init');
    });
  });

  describe('init', () => {
    it('creates a brain directory', () => {
      const { stdout, exitCode } = runKb('init');
      expect(exitCode).toBe(0);
      expect(stdout).toContain('initialized');
      expect(fs.existsSync(path.join(brainPath, 'manifest.json'))).toBe(true);
      expect(fs.existsSync(path.join(brainPath, 'areas'))).toBe(true);
    });

    it('reports error when brain already exists', () => {
      runKb('init');
      const { stdout, exitCode } = runKb('init');
      expect(exitCode).toBe(1);
      expect(stdout).toContain('already');
    });

    it('creates an area with init area', () => {
      runKb('init');
      const { stdout, exitCode } = runKb('init area networking "Networking" "Network knowledge"');
      expect(exitCode).toBe(0);
      expect(stdout).toContain('networking');
      expect(fs.existsSync(path.join(brainPath, 'areas', 'networking', 'area.json'))).toBe(true);
    });

    it('init area updates manifest.json so the scorer sees the new area', () => {
      // Regression for the bug surfaced by experiments/area-scoring/: areas
      // created via `kb init area` were invisible to the context-hook scorer
      // because manifest.json wasn't regenerated. The Pi extension reads
      // manifest at every turn and falls back to listAreas only when the
      // manifest is empty — so a stale manifest silently broke scoring for
      // every newly-created area.
      runKb('init');
      runKb('init area networking "Networking" "Network knowledge"');
      const manifestPath = path.join(brainPath, 'manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as {
        areas: { id: string; summary: string }[];
      };
      const ids = manifest.areas.map((a) => a.id);
      expect(ids).toContain('networking');
      const networking = manifest.areas.find((a) => a.id === 'networking');
      expect(networking?.summary).toBe('Network knowledge');
    });
  });

  describe('add', () => {
    beforeEach(() => {
      runKb('init');
    });

    it('adds a fact', () => {
      const { stdout, exitCode } = runKb('add fact networking "DNS uses CoreDNS" --source docs');
      expect(exitCode).toBe(0);
      expect(stdout).toContain('added fact');
      expect(stdout).toContain('networking');
    });

    it('adds a fact with tags', () => {
      const { stdout, exitCode } = runKb(
        'add fact networking "DNS uses CoreDNS" --tags dns,coredns',
      );
      expect(exitCode).toBe(0);
      expect(stdout).toContain('added fact');
    });

    it('adds a decision', () => {
      const { stdout, exitCode } = runKb(
        'add decision networking "Use CoreDNS" --why "Performance" --source arch-review',
      );
      expect(exitCode).toBe(0);
      expect(stdout).toContain('added decision');
    });

    it('adds a gotcha', () => {
      const { stdout, exitCode } = runKb('add gotcha networking "DNS caching issue" --failed');
      expect(exitCode).toBe(0);
      expect(stdout).toContain('added gotcha');
    });

    it('adds a pattern', () => {
      const { stdout, exitCode } = runKb('add pattern networking "Always flush DNS"');
      expect(exitCode).toBe(0);
      expect(stdout).toContain('added pattern');
    });

    it('adds a link', () => {
      const { stdout, exitCode } = runKb(
        'add link networking "CoreDNS docs" https://coredns.io --source web',
      );
      expect(exitCode).toBe(0);
      expect(stdout).toContain('added link');
    });

    it('fails without required arguments', () => {
      const { exitCode } = runKb('add fact');
      expect(exitCode).toBe(1);
    });
  });

  describe('load', () => {
    beforeEach(() => {
      runKb('init');
      runKb('add fact networking "DNS uses CoreDNS" --source docs');
    });

    it('shows markdown output by default', () => {
      const { stdout, exitCode } = runKb('load networking');
      expect(exitCode).toBe(0);
      expect(stdout).toContain('DNS uses CoreDNS');
      expect(stdout).toContain('##');
    });

    it('shows json output with --json flag', () => {
      const { stdout, exitCode } = runKb('load networking --json');
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed[0].text).toBe('DNS uses CoreDNS');
    });

    it('filters by zone', () => {
      const { stdout, exitCode } = runKb('load networking --zone archive');
      expect(exitCode).toBe(0);
      expect(stdout).not.toContain('DNS uses CoreDNS');
    });

    it('filters by tag', () => {
      runKb('add fact networking "tagged entry" --tags important');
      const { stdout, exitCode } = runKb('load networking --tag important');
      expect(exitCode).toBe(0);
      expect(stdout).toContain('tagged entry');
    });

    it('fails without area argument', () => {
      const { exitCode } = runKb('load');
      expect(exitCode).toBe(1);
    });
  });

  describe('list', () => {
    it('lists areas', () => {
      runKb('init');
      runKb('add fact networking "test" --source test');
      const { stdout, exitCode } = runKb('list');
      expect(exitCode).toBe(0);
      expect(stdout).toContain('networking');
    });

    it('shows json with --json flag', () => {
      runKb('init');
      runKb('add fact networking "test" --source test');
      const { stdout, exitCode } = runKb('list --json');
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout);
      expect(Array.isArray(parsed)).toBe(true);
    });
  });

  describe('search', () => {
    beforeEach(() => {
      runKb('init');
      runKb('add fact networking "DNS uses CoreDNS" --source docs');
      runKb('add fact security "firewall rules are strict" --source docs');
    });

    it('finds matching entries', () => {
      const { stdout, exitCode } = runKb('search DNS');
      expect(exitCode).toBe(0);
      expect(stdout).toContain('DNS uses CoreDNS');
    });

    it('returns empty for no matches', () => {
      const { stdout, exitCode } = runKb('search zzzznonexistent');
      expect(exitCode).toBe(0);
      expect(stdout.trim()).toBe('');
    });
  });

  describe('save', () => {
    it('commits changes', () => {
      runKb('init');
      runKb('add fact networking "test fact" --source test');
      const { stdout, exitCode } = runKb('save');
      expect(exitCode).toBe(0);
      expect(stdout).toContain('saved');
    });

    it('reports nothing to save when clean', () => {
      runKb('init');
      runKb('save'); // first save
      const { stdout, exitCode } = runKb('save');
      expect(exitCode).toBe(0);
      expect(stdout).toContain('nothing');
    });
  });

  describe('match', () => {
    it('finds relevant areas', () => {
      runKb('init');
      runKb('add fact networking "DNS uses CoreDNS" --source docs');
      const { stdout, exitCode } = runKb('match DNS');
      expect(exitCode).toBe(0);
      expect(stdout).toContain('networking');
    });
  });

  describe('verify', () => {
    it('verifies an entry', () => {
      runKb('init');
      const addResult = runKb('add fact networking "test fact"');
      const idMatch = addResult.stdout.match(/[a-zA-Z0-9_-]{8}/);
      expect(idMatch).not.toBeNull();
      const id = idMatch![0];
      const { stdout, exitCode } = runKb(`verify networking ${id}`);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('verified');
    });
  });

  describe('promote', () => {
    it('promotes an entry to established', () => {
      runKb('init');
      const addResult = runKb('add fact networking "test fact"');
      const idMatch = addResult.stdout.match(/[a-zA-Z0-9_-]{8}/);
      const id = idMatch![0];
      const { stdout, exitCode } = runKb(`promote networking ${id}`);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('promoted');
    });
  });

  describe('archive', () => {
    it('archives an entry', () => {
      runKb('init');
      const addResult = runKb('add fact networking "test fact"');
      const idMatch = addResult.stdout.match(/[a-zA-Z0-9_-]{8}/);
      const id = idMatch![0];
      const { stdout, exitCode } = runKb(`archive networking ${id}`);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('archived');
    });
  });

  describe('delete', () => {
    it('deletes an entry', () => {
      runKb('init');
      const addResult = runKb('add fact networking "test fact"');
      const idMatch = addResult.stdout.match(/[a-zA-Z0-9_-]{8}/);
      const id = idMatch![0];
      const { stdout, exitCode } = runKb(`delete networking ${id}`);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('deleted');
    });
  });

  describe('stats', () => {
    it('shows entry counts', () => {
      runKb('init');
      runKb('add fact networking "test fact"');
      runKb('add decision networking "test decision"');
      const { stdout, exitCode } = runKb('stats');
      expect(exitCode).toBe(0);
      expect(stdout).toContain('networking');
      expect(stdout).toContain('fact');
    });
  });

  describe('compact', () => {
    it('compacts entries', () => {
      runKb('init');
      runKb('add fact networking "test fact"');
      const { stdout, exitCode } = runKb('compact networking');
      expect(exitCode).toBe(0);
      expect(stdout).toContain('compacted');
    });

    it('compacts all areas without argument', () => {
      runKb('init');
      runKb('add fact networking "test fact"');
      const { stdout, exitCode } = runKb('compact');
      expect(exitCode).toBe(0);
      expect(stdout).toContain('compacted');
    });
  });

  describe('rebuild', () => {
    it('rebuilds the database', () => {
      runKb('init');
      runKb('add fact networking "test fact"');
      // Delete the db to simulate corruption
      const dbPath = path.join(brainPath, 'kb.db');
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
      const walPath = dbPath + '-wal';
      if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
      const shmPath = dbPath + '-shm';
      if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);

      const { stdout, exitCode } = runKb('rebuild');
      expect(exitCode).toBe(0);
      expect(stdout).toContain('rebuilt');
      // Verify data is still there
      const loadResult = runKb('load networking');
      expect(loadResult.stdout).toContain('test fact');
    });
  });

  describe('export', () => {
    it('exports area index as agents-md', () => {
      runKb('init');
      runKb('init area networking "Networking" "Network knowledge"');
      const { stdout, exitCode } = runKb('export agents-md');
      expect(exitCode).toBe(0);
      expect(stdout).toContain('networking');
    });
  });

  describe('area management', () => {
    beforeEach(() => {
      runKb('init');
      runKb('init area test-area "Test Area" "A test area"');
    });

    it('updates area metadata', () => {
      const { stdout, exitCode } = runKb('area update test-area --summary "Updated summary"');
      expect(exitCode).toBe(0);
      expect(stdout).toContain('updated');
    });

    it('deletes an area', () => {
      const { stdout, exitCode } = runKb('area delete test-area');
      expect(exitCode).toBe(0);
      expect(stdout).toContain('deleted');
      expect(fs.existsSync(path.join(brainPath, 'areas', 'test-area'))).toBe(false);
    });
  });

  describe('update entry', () => {
    it('updates entry text', () => {
      runKb('init');
      const addResult = runKb('add fact networking "original text"');
      const idMatch = addResult.stdout.match(/[a-zA-Z0-9_-]{8}/);
      const id = idMatch![0];
      const { stdout, exitCode } = runKb(`update networking ${id} --text "updated text"`);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('updated');
      // Verify the update
      const loadResult = runKb('load networking --json');
      expect(loadResult.stdout).toContain('updated text');
    });
  });

  describe('stale', () => {
    it('runs without error', () => {
      runKb('init');
      runKb('add fact networking "test fact"');
      const { exitCode } = runKb('stale');
      expect(exitCode).toBe(0);
    });
  });
});
