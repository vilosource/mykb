import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
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

describe('FileSystemWorkspaceStorage Document Index', () => {
  it('scanDocumentIndex with no docs returns empty array', async () => {
    await withTempBrain(async (brainPath) => {
      const storage = new FileSystemWorkspaceStorage(brainPath);
      storage.createWorkspace('my-proj', 'My Project');

      const docs = storage.scanDocumentIndex('my-proj');
      expect(docs).toEqual([]);
    });
  });

  it('scanDocumentIndex finds .md files in workspace directory', async () => {
    await withTempBrain(async (brainPath) => {
      const storage = new FileSystemWorkspaceStorage(brainPath);
      storage.createWorkspace('my-proj', 'My Project');

      const wsDir = path.join(brainPath, 'workspaces', 'my-proj');
      fs.writeFileSync(path.join(wsDir, 'notes.md'), '# Notes\nSome content\n');

      const docs = storage.scanDocumentIndex('my-proj');
      expect(docs).toHaveLength(1);
      expect(docs[0].path).toBe('notes.md');
      expect(docs[0].description).toBeNull();
    });
  });

  it('scanDocumentIndex with doc missing frontmatter returns description null', async () => {
    await withTempBrain(async (brainPath) => {
      const storage = new FileSystemWorkspaceStorage(brainPath);
      storage.createWorkspace('my-proj', 'My Project');

      const wsDir = path.join(brainPath, 'workspaces', 'my-proj');
      fs.writeFileSync(path.join(wsDir, 'plain.md'), 'Just plain text\n');

      const docs = storage.scanDocumentIndex('my-proj');
      const doc = docs.find((d) => d.path === 'plain.md');
      expect(doc).toBeDefined();
      expect(doc!.description).toBeNull();
    });
  });

  it('scanDocumentIndex with doc having frontmatter extracts description', async () => {
    await withTempBrain(async (brainPath) => {
      const storage = new FileSystemWorkspaceStorage(brainPath);
      storage.createWorkspace('my-proj', 'My Project');

      const wsDir = path.join(brainPath, 'workspaces', 'my-proj');
      fs.writeFileSync(
        path.join(wsDir, 'spec.md'),
        '---\ndescription: Server inventory and IPs\n---\n# Spec\nContent here\n'
      );

      const docs = storage.scanDocumentIndex('my-proj');
      const doc = docs.find((d) => d.path === 'spec.md');
      expect(doc).toBeDefined();
      expect(doc!.description).toBe('Server inventory and IPs');
    });
  });

  it('scanDocumentIndex finds docs in subdirectories', async () => {
    await withTempBrain(async (brainPath) => {
      const storage = new FileSystemWorkspaceStorage(brainPath);
      storage.createWorkspace('my-proj', 'My Project');

      const wsDir = path.join(brainPath, 'workspaces', 'my-proj');
      const docsDir = path.join(wsDir, 'docs');
      fs.mkdirSync(docsDir, { recursive: true });
      fs.writeFileSync(
        path.join(docsDir, 'deep.md'),
        '---\ndescription: Deep doc\n---\n# Deep\n'
      );

      const docs = storage.scanDocumentIndex('my-proj');
      const doc = docs.find((d) => d.path === 'docs/deep.md');
      expect(doc).toBeDefined();
      expect(doc!.description).toBe('Deep doc');
    });
  });

  it('updateDocumentIndex writes scanned docs to workspace.json', async () => {
    await withTempBrain(async (brainPath) => {
      const storage = new FileSystemWorkspaceStorage(brainPath);
      storage.createWorkspace('my-proj', 'My Project');

      const wsDir = path.join(brainPath, 'workspaces', 'my-proj');
      fs.writeFileSync(
        path.join(wsDir, 'readme.md'),
        '---\ndescription: Project readme\n---\n# README\n'
      );

      storage.updateDocumentIndex('my-proj');

      const ws = storage.readWorkspace('my-proj');
      expect(ws).not.toBeNull();
      expect(ws!.documents).toHaveLength(1);
      expect(ws!.documents[0].path).toBe('readme.md');
      expect(ws!.documents[0].description).toBe('Project readme');
    });
  });
});

describe('FileSystemWorkspaceStorage Session Isolation (KB_SESSION_ID)', () => {
  let savedSessionId: string | undefined;

  beforeEach(() => {
    savedSessionId = process.env.KB_SESSION_ID;
  });

  afterEach(() => {
    if (savedSessionId === undefined) {
      delete process.env.KB_SESSION_ID;
    } else {
      process.env.KB_SESSION_ID = savedSessionId;
    }
  });

  it('getActiveWorkspaceId with KB_SESSION_ID set + session file exists returns file content', async () => {
    await withTempBrain(async (brainPath) => {
      const sessionId = `test-${randomUUID()}`;
      process.env.KB_SESSION_ID = sessionId;

      const sessionFile = path.join(os.tmpdir(), `.mykb-session-${sessionId}`);
      fs.writeFileSync(sessionFile, 'my-workspace\n');

      try {
        const storage = new FileSystemWorkspaceStorage(brainPath);
        expect(storage.getActiveWorkspaceId()).toBe('my-workspace');
      } finally {
        if (fs.existsSync(sessionFile)) fs.unlinkSync(sessionFile);
      }
    });
  });

  it('getActiveWorkspaceId with KB_SESSION_ID set + no session file returns null', async () => {
    await withTempBrain(async (brainPath) => {
      const sessionId = `test-${randomUUID()}`;
      process.env.KB_SESSION_ID = sessionId;

      const storage = new FileSystemWorkspaceStorage(brainPath);
      expect(storage.getActiveWorkspaceId()).toBeNull();
    });
  });

  it('getActiveWorkspaceId with KB_SESSION_ID not set + .active exists returns .active content', async () => {
    await withTempBrain(async (brainPath) => {
      delete process.env.KB_SESSION_ID;

      const storage = new FileSystemWorkspaceStorage(brainPath);
      storage.createWorkspace('fallback-ws', 'Fallback');
      // Write .active directly
      const activeFile = path.join(brainPath, 'workspaces', '.active');
      fs.writeFileSync(activeFile, 'fallback-ws\n');

      expect(storage.getActiveWorkspaceId()).toBe('fallback-ws');
    });
  });

  it('setActiveWorkspaceId with KB_SESSION_ID set writes to session file, .active unchanged', async () => {
    await withTempBrain(async (brainPath) => {
      const sessionId = `test-${randomUUID()}`;
      process.env.KB_SESSION_ID = sessionId;

      const sessionFile = path.join(os.tmpdir(), `.mykb-session-${sessionId}`);
      const activeFile = path.join(brainPath, 'workspaces', '.active');

      try {
        const storage = new FileSystemWorkspaceStorage(brainPath);
        storage.createWorkspace('session-ws', 'Session WS');

        // Pre-set .active to something else
        fs.mkdirSync(path.join(brainPath, 'workspaces'), { recursive: true });
        fs.writeFileSync(activeFile, 'other-ws\n');

        storage.setActiveWorkspaceId('session-ws');

        // Session file should have the workspace ID
        expect(fs.existsSync(sessionFile)).toBe(true);
        expect(fs.readFileSync(sessionFile, 'utf-8').trim()).toBe('session-ws');

        // .active should be unchanged
        expect(fs.readFileSync(activeFile, 'utf-8').trim()).toBe('other-ws');
      } finally {
        if (fs.existsSync(sessionFile)) fs.unlinkSync(sessionFile);
      }
    });
  });

  it('setActiveWorkspaceId with KB_SESSION_ID not set writes to .active', async () => {
    await withTempBrain(async (brainPath) => {
      delete process.env.KB_SESSION_ID;

      const storage = new FileSystemWorkspaceStorage(brainPath);
      storage.createWorkspace('global-ws', 'Global WS');
      storage.setActiveWorkspaceId('global-ws');

      const activeFile = path.join(brainPath, 'workspaces', '.active');
      expect(fs.readFileSync(activeFile, 'utf-8').trim()).toBe('global-ws');
    });
  });

  it('clearActiveWorkspaceId with KB_SESSION_ID set removes session file, .active unchanged', async () => {
    await withTempBrain(async (brainPath) => {
      const sessionId = `test-${randomUUID()}`;
      process.env.KB_SESSION_ID = sessionId;

      const sessionFile = path.join(os.tmpdir(), `.mykb-session-${sessionId}`);
      const activeFile = path.join(brainPath, 'workspaces', '.active');

      try {
        // Set up session file and .active
        fs.writeFileSync(sessionFile, 'session-ws\n');
        fs.mkdirSync(path.join(brainPath, 'workspaces'), { recursive: true });
        fs.writeFileSync(activeFile, 'global-ws\n');

        const storage = new FileSystemWorkspaceStorage(brainPath);
        storage.clearActiveWorkspaceId();

        // Session file should be gone
        expect(fs.existsSync(sessionFile)).toBe(false);
        // .active should be unchanged
        expect(fs.readFileSync(activeFile, 'utf-8').trim()).toBe('global-ws');
      } finally {
        if (fs.existsSync(sessionFile)) fs.unlinkSync(sessionFile);
      }
    });
  });

  it('clearActiveWorkspaceId with KB_SESSION_ID not set removes .active', async () => {
    await withTempBrain(async (brainPath) => {
      delete process.env.KB_SESSION_ID;

      const storage = new FileSystemWorkspaceStorage(brainPath);
      storage.createWorkspace('doomed-ws', 'Doomed');
      fs.mkdirSync(path.join(brainPath, 'workspaces'), { recursive: true });
      fs.writeFileSync(path.join(brainPath, 'workspaces', '.active'), 'doomed-ws\n');

      storage.clearActiveWorkspaceId();

      expect(fs.existsSync(path.join(brainPath, 'workspaces', '.active'))).toBe(false);
    });
  });
});
