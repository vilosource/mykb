import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { withTempBrain } from '../helpers.js';
import { FileSystemWorkspaceStorage } from '../../src/core/workspace.js';
import type { Workspace, WorkspaceState } from '../../src/core/types.js';

describe('FileSystemWorkspaceStorage CRUD', () => {
  it('createWorkspace creates workspace.json with correct structure', async () => {
    await withTempBrain(async (brainPath) => {
      const storage = new FileSystemWorkspaceStorage(brainPath);
      storage.createWorkspace('my-proj', 'My Project');

      const wsFile = path.join(brainPath, 'workspaces', 'my-proj', 'workspace.json');
      expect(fs.existsSync(wsFile)).toBe(true);

      const data = JSON.parse(fs.readFileSync(wsFile, 'utf-8')) as Workspace;
      expect(data.id).toBe('my-proj');
      expect(data.name).toBe('My Project');
      expect(data.state).toEqual({});
      expect(data.areas).toEqual([]);
      expect(data.links).toEqual({});
      expect(data.documents).toEqual([]);
      expect(data.created).toBeDefined();
      expect(data.updated).toBeDefined();
    });
  });

  it('createWorkspace with options sets areas and links', async () => {
    await withTempBrain(async (brainPath) => {
      const storage = new FileSystemWorkspaceStorage(brainPath);
      storage.createWorkspace('my-proj', 'My Project', {
        areas: ['infra', 'app'],
        links: { jira: 'PROJ-1', wiki: 'https://wiki.example.com' },
      });

      const ws = storage.readWorkspace('my-proj');
      expect(ws).not.toBeNull();
      expect(ws!.areas).toEqual(['infra', 'app']);
      expect(ws!.links.jira).toBe('PROJ-1');
      expect(ws!.links.wiki).toBe('https://wiki.example.com');
    });
  });

  it('readWorkspace returns Workspace object with all fields', async () => {
    await withTempBrain(async (brainPath) => {
      const storage = new FileSystemWorkspaceStorage(brainPath);
      storage.createWorkspace('my-proj', 'My Project');

      const ws = storage.readWorkspace('my-proj');
      expect(ws).not.toBeNull();
      expect(ws!.id).toBe('my-proj');
      expect(ws!.name).toBe('My Project');
      expect(ws!.state).toEqual({});
      expect(ws!.areas).toEqual([]);
      expect(ws!.links).toEqual({});
      expect(ws!.documents).toEqual([]);
      expect(typeof ws!.created).toBe('string');
      expect(typeof ws!.updated).toBe('string');
    });
  });

  it('readWorkspace returns null for non-existent workspace', async () => {
    await withTempBrain(async (brainPath) => {
      const storage = new FileSystemWorkspaceStorage(brainPath);
      const ws = storage.readWorkspace('does-not-exist');
      expect(ws).toBeNull();
    });
  });

  describe('updateWorkspaceState — table-driven', () => {
    const cases: { name: string; update: Partial<WorkspaceState>; expected: Partial<WorkspaceState> }[] = [
      {
        name: 'phase only',
        update: { phase: 'setup' },
        expected: { phase: 'setup' },
      },
      {
        name: 'active only',
        update: { active: 'deploy step' },
        expected: { active: 'deploy step' },
      },
      {
        name: 'multiple fields',
        update: { phase: 'testing', blocked: 'waiting on deps', next: 'release' },
        expected: { phase: 'testing', blocked: 'waiting on deps', next: 'release' },
      },
    ];

    for (const tc of cases) {
      it(`modifies ${tc.name}`, async () => {
        await withTempBrain(async (brainPath) => {
          const storage = new FileSystemWorkspaceStorage(brainPath);
          storage.createWorkspace('my-proj', 'My Project');
          storage.updateWorkspaceState('my-proj', tc.update);

          const ws = storage.readWorkspace('my-proj');
          expect(ws).not.toBeNull();
          for (const [key, value] of Object.entries(tc.expected)) {
            expect(ws!.state[key as keyof WorkspaceState]).toBe(value);
          }
        });
      });
    }
  });

  it('updateWorkspaceLinks modifies link fields', async () => {
    await withTempBrain(async (brainPath) => {
      const storage = new FileSystemWorkspaceStorage(brainPath);
      storage.createWorkspace('my-proj', 'My Project');
      storage.updateWorkspaceLinks('my-proj', { jira: 'PROJ-1', repos: ['repo-a'] });

      const ws = storage.readWorkspace('my-proj');
      expect(ws).not.toBeNull();
      expect(ws!.links.jira).toBe('PROJ-1');
      expect(ws!.links.repos).toEqual(['repo-a']);
    });
  });

  it('linkArea adds area to workspace.areas without duplicates', async () => {
    await withTempBrain(async (brainPath) => {
      const storage = new FileSystemWorkspaceStorage(brainPath);
      storage.createWorkspace('my-proj', 'My Project');

      storage.linkArea('my-proj', 'infra');
      storage.linkArea('my-proj', 'app');
      storage.linkArea('my-proj', 'infra'); // duplicate

      const ws = storage.readWorkspace('my-proj');
      expect(ws).not.toBeNull();
      expect(ws!.areas).toEqual(['infra', 'app']);
    });
  });

  it('unlinkArea removes area from workspace.areas', async () => {
    await withTempBrain(async (brainPath) => {
      const storage = new FileSystemWorkspaceStorage(brainPath);
      storage.createWorkspace('my-proj', 'My Project', { areas: ['infra', 'app', 'db'] });

      storage.unlinkArea('my-proj', 'app');

      const ws = storage.readWorkspace('my-proj');
      expect(ws).not.toBeNull();
      expect(ws!.areas).toEqual(['infra', 'db']);
    });
  });

  it('listWorkspaces returns all non-archived workspaces', async () => {
    await withTempBrain(async (brainPath) => {
      const storage = new FileSystemWorkspaceStorage(brainPath);
      storage.createWorkspace('proj-a', 'Project A');
      storage.createWorkspace('proj-b', 'Project B');

      const list = storage.listWorkspaces();
      expect(list).toHaveLength(2);
      const ids = list.map((w) => w.id);
      expect(ids).toContain('proj-a');
      expect(ids).toContain('proj-b');
    });
  });

  it('archiveWorkspace moves workspace to archive directory', async () => {
    await withTempBrain(async (brainPath) => {
      const storage = new FileSystemWorkspaceStorage(brainPath);
      storage.createWorkspace('my-proj', 'My Project');
      storage.archiveWorkspace('my-proj');

      const archiveFile = path.join(brainPath, 'workspaces', 'archive', 'my-proj', 'workspace.json');
      expect(fs.existsSync(archiveFile)).toBe(true);

      const originalFile = path.join(brainPath, 'workspaces', 'my-proj', 'workspace.json');
      expect(fs.existsSync(originalFile)).toBe(false);
    });
  });

  it('archived workspace is not in listWorkspaces', async () => {
    await withTempBrain(async (brainPath) => {
      const storage = new FileSystemWorkspaceStorage(brainPath);
      storage.createWorkspace('proj-a', 'Project A');
      storage.createWorkspace('proj-b', 'Project B');
      storage.archiveWorkspace('proj-a');

      const list = storage.listWorkspaces();
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe('proj-b');
    });
  });

  it('getActiveWorkspaceId / setActiveWorkspaceId / clearActiveWorkspaceId', async () => {
    await withTempBrain(async (brainPath) => {
      const storage = new FileSystemWorkspaceStorage(brainPath);

      // Initially null
      expect(storage.getActiveWorkspaceId()).toBeNull();

      // Set active
      storage.createWorkspace('my-proj', 'My Project');
      storage.setActiveWorkspaceId('my-proj');
      expect(storage.getActiveWorkspaceId()).toBe('my-proj');

      // Clear active
      storage.clearActiveWorkspaceId();
      expect(storage.getActiveWorkspaceId()).toBeNull();
    });
  });

  it('createWorkspace auto-creates workspaces directory', async () => {
    await withTempBrain(async (brainPath) => {
      // workspaces dir does not exist yet
      const wsDir = path.join(brainPath, 'workspaces');
      expect(fs.existsSync(wsDir)).toBe(false);

      const storage = new FileSystemWorkspaceStorage(brainPath);
      storage.createWorkspace('my-proj', 'My Project');

      expect(fs.existsSync(wsDir)).toBe(true);
    });
  });

  it('readWorkspace with linked area that does not exist in mykb returns workspace normally', async () => {
    await withTempBrain(async (brainPath) => {
      const storage = new FileSystemWorkspaceStorage(brainPath);
      storage.createWorkspace('my-proj', 'My Project', { areas: ['nonexistent-area'] });

      const ws = storage.readWorkspace('my-proj');
      expect(ws).not.toBeNull();
      expect(ws!.areas).toEqual(['nonexistent-area']);
    });
  });
});

describe('FileSystemWorkspaceStorage Journal', () => {
  it('appendJournal appends to journal.jsonl', async () => {
    await withTempBrain(async (brainPath) => {
      const storage = new FileSystemWorkspaceStorage(brainPath);
      storage.createWorkspace('my-proj', 'My Project');

      storage.appendJournal('my-proj', 'Set up CI pipeline');
      storage.appendJournal('my-proj', 'Configured DNS');

      const journalFile = path.join(brainPath, 'workspaces', 'my-proj', 'journal.jsonl');
      expect(fs.existsSync(journalFile)).toBe(true);

      const lines = fs.readFileSync(journalFile, 'utf-8').trim().split('\n');
      expect(lines).toHaveLength(2);

      const entry0 = JSON.parse(lines[0]) as { date: string; text: string };
      expect(entry0.text).toBe('Set up CI pipeline');
      expect(entry0.date).toBeDefined();

      const entry1 = JSON.parse(lines[1]) as { date: string; text: string };
      expect(entry1.text).toBe('Configured DNS');
    });
  });

  it('readJournal returns entries most recent last', async () => {
    await withTempBrain(async (brainPath) => {
      const storage = new FileSystemWorkspaceStorage(brainPath);
      storage.createWorkspace('my-proj', 'My Project');

      storage.appendJournal('my-proj', 'First entry');
      storage.appendJournal('my-proj', 'Second entry');
      storage.appendJournal('my-proj', 'Third entry');

      const entries = storage.readJournal('my-proj');
      expect(entries).toHaveLength(3);
      expect(entries[0].text).toBe('First entry');
      expect(entries[2].text).toBe('Third entry');
    });
  });

  it('readJournal with limit returns last N entries', async () => {
    await withTempBrain(async (brainPath) => {
      const storage = new FileSystemWorkspaceStorage(brainPath);
      storage.createWorkspace('my-proj', 'My Project');

      storage.appendJournal('my-proj', 'First');
      storage.appendJournal('my-proj', 'Second');
      storage.appendJournal('my-proj', 'Third');

      const entries = storage.readJournal('my-proj', 2);
      expect(entries).toHaveLength(2);
      expect(entries[0].text).toBe('Second');
      expect(entries[1].text).toBe('Third');
    });
  });

  it('readJournal with empty/no journal returns empty array', async () => {
    await withTempBrain(async (brainPath) => {
      const storage = new FileSystemWorkspaceStorage(brainPath);
      storage.createWorkspace('my-proj', 'My Project');

      const entries = storage.readJournal('my-proj');
      expect(entries).toEqual([]);
    });
  });
});
