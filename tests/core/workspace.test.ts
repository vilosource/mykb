import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { withTempBrain } from '../helpers.js';
import { FileSystemWorkspaceStorage } from '../../src/core/workspace.js';
import type { Workspace, WorkspaceState, ArtifactEntry, HandoffData } from '../../src/core/types.js';
import { EntryValidationError, ArtifactNotFoundError, WorkspaceNotFoundError } from '../../src/core/errors.js';

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
      expect(data.artifacts).toEqual([]);
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
      expect(ws!.artifacts).toEqual([]);
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

describe('FileSystemWorkspaceStorage Notes', () => {
  it('appendNote appends to notes.jsonl and returns id', async () => {
    await withTempBrain(async (brainPath) => {
      const storage = new FileSystemWorkspaceStorage(brainPath);
      storage.createWorkspace('my-proj', 'My Project');

      const id = storage.appendNote('my-proj', 'Login throws 500 on expired session', ['bug']);

      expect(id).toBeDefined();
      expect(typeof id).toBe('string');

      const notesFile = path.join(brainPath, 'workspaces', 'my-proj', 'notes.jsonl');
      expect(fs.existsSync(notesFile)).toBe(true);

      const lines = fs.readFileSync(notesFile, 'utf-8').trim().split('\n');
      expect(lines).toHaveLength(1);

      const entry = JSON.parse(lines[0]) as { id: string; date: string; text: string; tags: string[] };
      expect(entry.id).toBe(id);
      expect(entry.text).toBe('Login throws 500 on expired session');
      expect(entry.tags).toEqual(['bug']);
      expect(entry.date).toBeDefined();
    });
  });

  it('appendNote defaults to empty tags', async () => {
    await withTempBrain(async (brainPath) => {
      const storage = new FileSystemWorkspaceStorage(brainPath);
      storage.createWorkspace('my-proj', 'My Project');

      storage.appendNote('my-proj', 'Something to remember');

      const notes = storage.readNotes('my-proj');
      expect(notes).toHaveLength(1);
      expect(notes[0].tags).toEqual([]);
    });
  });

  it('readNotes returns all notes', async () => {
    await withTempBrain(async (brainPath) => {
      const storage = new FileSystemWorkspaceStorage(brainPath);
      storage.createWorkspace('my-proj', 'My Project');

      storage.appendNote('my-proj', 'First note', ['bug']);
      storage.appendNote('my-proj', 'Second note', ['idea']);
      storage.appendNote('my-proj', 'Third note', ['bug', 'ux']);

      const notes = storage.readNotes('my-proj');
      expect(notes).toHaveLength(3);
      expect(notes[0].text).toBe('First note');
      expect(notes[2].text).toBe('Third note');
    });
  });

  it('readNotes filters by tag', async () => {
    await withTempBrain(async (brainPath) => {
      const storage = new FileSystemWorkspaceStorage(brainPath);
      storage.createWorkspace('my-proj', 'My Project');

      storage.appendNote('my-proj', 'Login bug', ['bug']);
      storage.appendNote('my-proj', 'Maybe use Redis', ['idea']);
      storage.appendNote('my-proj', 'API inconsistency', ['bug', 'api']);

      const bugs = storage.readNotes('my-proj', 'bug');
      expect(bugs).toHaveLength(2);
      expect(bugs[0].text).toBe('Login bug');
      expect(bugs[1].text).toBe('API inconsistency');

      const ideas = storage.readNotes('my-proj', 'idea');
      expect(ideas).toHaveLength(1);
      expect(ideas[0].text).toBe('Maybe use Redis');
    });
  });

  it('readNotes with empty/no notes returns empty array', async () => {
    await withTempBrain(async (brainPath) => {
      const storage = new FileSystemWorkspaceStorage(brainPath);
      storage.createWorkspace('my-proj', 'My Project');

      const notes = storage.readNotes('my-proj');
      expect(notes).toEqual([]);
    });
  });

  it('readNotes with tag filter and no matches returns empty array', async () => {
    await withTempBrain(async (brainPath) => {
      const storage = new FileSystemWorkspaceStorage(brainPath);
      storage.createWorkspace('my-proj', 'My Project');

      storage.appendNote('my-proj', 'A note', ['idea']);

      const bugs = storage.readNotes('my-proj', 'bug');
      expect(bugs).toEqual([]);
    });
  });

  it('deleteNote removes note via tombstone', async () => {
    await withTempBrain(async (brainPath) => {
      const storage = new FileSystemWorkspaceStorage(brainPath);
      storage.createWorkspace('my-proj', 'My Project');

      const id1 = storage.appendNote('my-proj', 'Keep this', ['idea']);
      const id2 = storage.appendNote('my-proj', 'Delete this', ['bug']);

      storage.deleteNote('my-proj', id2);

      const notes = storage.readNotes('my-proj');
      expect(notes).toHaveLength(1);
      expect(notes[0].text).toBe('Keep this');
    });
  });

  it('deleteNote throws for non-existent note', async () => {
    await withTempBrain(async (brainPath) => {
      const storage = new FileSystemWorkspaceStorage(brainPath);
      storage.createWorkspace('my-proj', 'My Project');

      expect(() => storage.deleteNote('my-proj', 'nonexistent')).toThrow('Note not found');
    });
  });
});

describe('FileSystemWorkspaceStorage Backward Compat (documents → artifacts)', () => {
  const cases = [
    {
      name: 'workspace.json with documents field migrates to artifacts: []',
      setup: (raw: Record<string, unknown>) => {
        delete raw.artifacts;
        raw.documents = [{ path: 'old.md', description: 'legacy doc' }];
      },
      expectArtifacts: [],
      expectNoDocuments: true,
    },
    {
      name: 'workspace.json with neither documents nor artifacts defaults to artifacts: []',
      setup: (raw: Record<string, unknown>) => {
        delete raw.artifacts;
        delete raw.documents;
      },
      expectArtifacts: [],
      expectNoDocuments: false,
    },
    {
      name: 'workspace.json with artifacts field returns artifacts as-is',
      setup: (raw: Record<string, unknown>) => {
        raw.artifacts = [{ id: 'abc12345', filename: 'test-PLAN.md', type: 'plan', description: 'A test plan' }];
      },
      expectArtifacts: [{ id: 'abc12345', filename: 'test-PLAN.md', type: 'plan', description: 'A test plan' }],
      expectNoDocuments: false,
    },
  ];

  it.each(cases)('$name', async ({ setup, expectArtifacts, expectNoDocuments }) => {
    await withTempBrain(async (brainPath) => {
      const storage = new FileSystemWorkspaceStorage(brainPath);
      storage.createWorkspace('compat-test', 'Compat Test');

      const wsFile = path.join(brainPath, 'workspaces', 'compat-test', 'workspace.json');
      const raw = JSON.parse(fs.readFileSync(wsFile, 'utf-8'));
      setup(raw);
      fs.writeFileSync(wsFile, JSON.stringify(raw, null, 2) + '\n');

      const ws = storage.readWorkspace('compat-test');
      expect(ws).not.toBeNull();
      expect(ws!.artifacts).toEqual(expectArtifacts);
      if (expectNoDocuments) {
        expect((ws as Record<string, unknown>).documents).toBeUndefined();
      }
    });
  });
});

describe('FileSystemWorkspaceStorage Artifacts', () => {
  describe('addArtifact', () => {
    const typeInferenceCases = [
      { name: 'infers plan from -PLAN suffix', filename: 'migration-PLAN.md', expectedType: 'plan' },
      { name: 'infers design from -DESIGN suffix', filename: 'arch-DESIGN.md', expectedType: 'design' },
      { name: 'infers analysis from -ANALYSIS suffix', filename: 'risk-ANALYSIS.md', expectedType: 'analysis' },
      { name: 'infers design from -ARCHITECTURE suffix', filename: 'sys-ARCHITECTURE.md', expectedType: 'design' },
      { name: 'infers report from -GUIDE suffix', filename: 'ops-GUIDE.md', expectedType: 'report' },
      { name: 'infers other when no matching suffix', filename: 'notes.md', expectedType: 'other' },
      { name: 'infers type case-insensitively', filename: 'foo-plan.md', expectedType: 'plan' },
    ];

    it.each(typeInferenceCases)('$name', async ({ filename, expectedType }) => {
      await withTempBrain(async (brainPath) => {
        const storage = new FileSystemWorkspaceStorage(brainPath);
        storage.createWorkspace('ws', 'Test');
        const id = storage.addArtifact('ws', filename, '# Content');
        const entry = storage.readArtifact('ws', id);
        expect(entry).not.toBeNull();
        expect(entry!.type).toBe(expectedType);
      });
    });

    it('writes file to docs/, creates artifacts.jsonl entry, updates workspace.json, returns id', async () => {
      await withTempBrain(async (brainPath) => {
        const storage = new FileSystemWorkspaceStorage(brainPath);
        storage.createWorkspace('ws', 'Test');
        const id = storage.addArtifact('ws', 'notes-PLAN.md', '# Notes');

        expect(typeof id).toBe('string');
        expect(id.length).toBeGreaterThan(0);

        // File written to docs/
        const docsDir = path.join(brainPath, 'workspaces', 'ws', 'docs');
        expect(fs.existsSync(path.join(docsDir, 'notes-PLAN.md'))).toBe(true);
        expect(fs.readFileSync(path.join(docsDir, 'notes-PLAN.md'), 'utf-8')).toBe('# Notes');

        // Entry in artifacts.jsonl
        const jsonlFile = path.join(brainPath, 'workspaces', 'ws', 'artifacts.jsonl');
        expect(fs.existsSync(jsonlFile)).toBe(true);
        const lines = fs.readFileSync(jsonlFile, 'utf-8').trim().split('\n');
        const entry = JSON.parse(lines[0]) as ArtifactEntry;
        expect(entry.id).toBe(id);
        expect(entry.filename).toBe('notes-PLAN.md');
        expect(entry.type).toBe('plan');

        // workspace.json artifacts updated
        const ws = storage.readWorkspace('ws');
        expect(ws!.artifacts).toHaveLength(1);
        expect(ws!.artifacts[0].id).toBe(id);
        expect(ws!.artifacts[0].filename).toBe('notes-PLAN.md');
      });
    });

    it('explicit type overrides inference', async () => {
      await withTempBrain(async (brainPath) => {
        const storage = new FileSystemWorkspaceStorage(brainPath);
        storage.createWorkspace('ws', 'Test');
        const id = storage.addArtifact('ws', 'foo.md', '# Foo', { type: 'analysis' });
        const entry = storage.readArtifact('ws', id);
        expect(entry!.type).toBe('analysis');
      });
    });

    const descriptionCases = [
      {
        name: 'extracts description from frontmatter',
        content: '---\ndescription: My desc\n---\n# Content',
        options: {},
        expectedDesc: 'My desc',
      },
      {
        name: 'explicit description overrides frontmatter',
        content: '---\ndescription: From frontmatter\n---\n# Content',
        options: { description: 'Override' },
        expectedDesc: 'Override',
      },
      {
        name: 'no frontmatter and no explicit description defaults to empty string',
        content: '# Just content',
        options: {},
        expectedDesc: '',
      },
    ];

    it.each(descriptionCases)('$name', async ({ content, options, expectedDesc }) => {
      await withTempBrain(async (brainPath) => {
        const storage = new FileSystemWorkspaceStorage(brainPath);
        storage.createWorkspace('ws', 'Test');
        const id = storage.addArtifact('ws', 'doc.md', content, options);
        const entry = storage.readArtifact('ws', id);
        expect(entry!.description).toBe(expectedDesc);
      });
    });

    it('sets tags and areas from options', async () => {
      await withTempBrain(async (brainPath) => {
        const storage = new FileSystemWorkspaceStorage(brainPath);
        storage.createWorkspace('ws', 'Test');
        const id = storage.addArtifact('ws', 'doc.md', '# Doc', { tags: ['t1', 't2'], areas: ['infra'] });
        const entry = storage.readArtifact('ws', id);
        expect(entry!.tags).toEqual(['t1', 't2']);
        expect(entry!.areas).toEqual(['infra']);
      });
    });

    it('defaults tags and areas to empty arrays', async () => {
      await withTempBrain(async (brainPath) => {
        const storage = new FileSystemWorkspaceStorage(brainPath);
        storage.createWorkspace('ws', 'Test');
        const id = storage.addArtifact('ws', 'doc.md', '# Doc');
        const entry = storage.readArtifact('ws', id);
        expect(entry!.tags).toEqual([]);
        expect(entry!.areas).toEqual([]);
      });
    });

    it('rejects non-.md filename', async () => {
      await withTempBrain(async (brainPath) => {
        const storage = new FileSystemWorkspaceStorage(brainPath);
        storage.createWorkspace('ws', 'Test');
        expect(() => storage.addArtifact('ws', 'script.sh', '#!/bin/bash')).toThrow(EntryValidationError);
      });
    });

    it('rejects duplicate filename', async () => {
      await withTempBrain(async (brainPath) => {
        const storage = new FileSystemWorkspaceStorage(brainPath);
        storage.createWorkspace('ws', 'Test');
        storage.addArtifact('ws', 'doc.md', '# First');
        expect(() => storage.addArtifact('ws', 'doc.md', '# Second')).toThrow(EntryValidationError);
      });
    });

    const pathTraversalCases = [
      { name: 'rejects filename with forward slash', filename: '../etc/passwd.md' },
      { name: 'rejects filename with backslash', filename: '..\\etc\\passwd.md' },
      { name: 'rejects filename with dot-dot', filename: '..doc.md' },
    ];

    it.each(pathTraversalCases)('$name', async ({ filename }) => {
      await withTempBrain(async (brainPath) => {
        const storage = new FileSystemWorkspaceStorage(brainPath);
        storage.createWorkspace('ws', 'Test');
        expect(() => storage.addArtifact('ws', filename, '# Bad')).toThrow(EntryValidationError);
      });
    });

    it('register-only mode works when file already exists in docs/', async () => {
      await withTempBrain(async (brainPath) => {
        const storage = new FileSystemWorkspaceStorage(brainPath);
        storage.createWorkspace('ws', 'Test');
        const docsDir = path.join(brainPath, 'workspaces', 'ws', 'docs');
        fs.mkdirSync(docsDir, { recursive: true });
        fs.writeFileSync(path.join(docsDir, 'existing-PLAN.md'), '---\ndescription: Pre-existing\n---\n# Plan');

        const id = storage.addArtifact('ws', 'existing-PLAN.md', '---\ndescription: Pre-existing\n---\n# Plan');
        const entry = storage.readArtifact('ws', id);
        expect(entry!.filename).toBe('existing-PLAN.md');
        expect(entry!.type).toBe('plan');
        expect(entry!.description).toBe('Pre-existing');
      });
    });

    it('register-only mode rejects if already registered in metadata', async () => {
      await withTempBrain(async (brainPath) => {
        const storage = new FileSystemWorkspaceStorage(brainPath);
        storage.createWorkspace('ws', 'Test');
        storage.addArtifact('ws', 'doc.md', '# Doc');
        // File exists on disk AND in metadata — should reject
        expect(() => storage.addArtifact('ws', 'doc.md', '# Doc again')).toThrow(EntryValidationError);
      });
    });
  });

  describe('listArtifacts', () => {
    it('returns empty array when no artifacts.jsonl exists', async () => {
      await withTempBrain(async (brainPath) => {
        const storage = new FileSystemWorkspaceStorage(brainPath);
        storage.createWorkspace('ws', 'Test');
        expect(storage.listArtifacts('ws')).toEqual([]);
      });
    });

    it('returns all added artifacts', async () => {
      await withTempBrain(async (brainPath) => {
        const storage = new FileSystemWorkspaceStorage(brainPath);
        storage.createWorkspace('ws', 'Test');
        storage.addArtifact('ws', 'one-PLAN.md', '# One');
        storage.addArtifact('ws', 'two-DESIGN.md', '# Two');
        const list = storage.listArtifacts('ws');
        expect(list).toHaveLength(2);
        expect(list.map((a) => a.filename)).toEqual(['one-PLAN.md', 'two-DESIGN.md']);
      });
    });

    it('excludes deleted artifacts', async () => {
      await withTempBrain(async (brainPath) => {
        const storage = new FileSystemWorkspaceStorage(brainPath);
        storage.createWorkspace('ws', 'Test');
        const id = storage.addArtifact('ws', 'doomed.md', '# Doomed');
        storage.addArtifact('ws', 'keeper.md', '# Keeper');
        storage.deleteArtifact('ws', id);
        const list = storage.listArtifacts('ws');
        expect(list).toHaveLength(1);
        expect(list[0].filename).toBe('keeper.md');
      });
    });
  });

  describe('readArtifact', () => {
    it('looks up by ID', async () => {
      await withTempBrain(async (brainPath) => {
        const storage = new FileSystemWorkspaceStorage(brainPath);
        storage.createWorkspace('ws', 'Test');
        const id = storage.addArtifact('ws', 'doc-PLAN.md', '# Plan');
        const entry = storage.readArtifact('ws', id);
        expect(entry).not.toBeNull();
        expect(entry!.id).toBe(id);
        expect(entry!.filename).toBe('doc-PLAN.md');
        expect(entry!.type).toBe('plan');
        expect(typeof entry!.created).toBe('string');
        expect(typeof entry!.updated).toBe('string');
      });
    });

    it('looks up by filename', async () => {
      await withTempBrain(async (brainPath) => {
        const storage = new FileSystemWorkspaceStorage(brainPath);
        storage.createWorkspace('ws', 'Test');
        storage.addArtifact('ws', 'doc-PLAN.md', '# Plan');
        const entry = storage.readArtifact('ws', 'doc-PLAN.md');
        expect(entry).not.toBeNull();
        expect(entry!.filename).toBe('doc-PLAN.md');
      });
    });

    it('returns null for non-existent ID or filename', async () => {
      await withTempBrain(async (brainPath) => {
        const storage = new FileSystemWorkspaceStorage(brainPath);
        storage.createWorkspace('ws', 'Test');
        expect(storage.readArtifact('ws', 'nonexistent')).toBeNull();
      });
    });

    it('returns null for deleted artifact', async () => {
      await withTempBrain(async (brainPath) => {
        const storage = new FileSystemWorkspaceStorage(brainPath);
        storage.createWorkspace('ws', 'Test');
        const id = storage.addArtifact('ws', 'doc.md', '# Doc');
        storage.deleteArtifact('ws', id);
        expect(storage.readArtifact('ws', id)).toBeNull();
      });
    });
  });

  describe('readArtifactContent', () => {
    const cases = [
      { name: 'returns content by ID', lookupBy: 'id' as const },
      { name: 'returns content by filename', lookupBy: 'filename' as const },
    ];

    it.each(cases)('$name', async ({ lookupBy }) => {
      await withTempBrain(async (brainPath) => {
        const storage = new FileSystemWorkspaceStorage(brainPath);
        storage.createWorkspace('ws', 'Test');
        const id = storage.addArtifact('ws', 'doc.md', '# My Content\nLine 2');
        const ref = lookupBy === 'id' ? id : 'doc.md';
        const content = storage.readArtifactContent('ws', ref);
        expect(content).toBe('# My Content\nLine 2');
      });
    });

    it('returns null for non-existent artifact', async () => {
      await withTempBrain(async (brainPath) => {
        const storage = new FileSystemWorkspaceStorage(brainPath);
        storage.createWorkspace('ws', 'Test');
        expect(storage.readArtifactContent('ws', 'nonexistent')).toBeNull();
      });
    });

    it('returns null when metadata exists but file is missing', async () => {
      await withTempBrain(async (brainPath) => {
        const storage = new FileSystemWorkspaceStorage(brainPath);
        storage.createWorkspace('ws', 'Test');
        const id = storage.addArtifact('ws', 'doc.md', '# Content');
        // Manually delete the file but leave metadata
        fs.unlinkSync(path.join(brainPath, 'workspaces', 'ws', 'docs', 'doc.md'));
        expect(storage.readArtifactContent('ws', id)).toBeNull();
      });
    });
  });

  describe('updateArtifact', () => {
    it('updates description and refreshes summary', async () => {
      await withTempBrain(async (brainPath) => {
        const storage = new FileSystemWorkspaceStorage(brainPath);
        storage.createWorkspace('ws', 'Test');
        const id = storage.addArtifact('ws', 'doc.md', '# Doc');
        storage.updateArtifact('ws', id, { description: 'Updated desc' });

        const entry = storage.readArtifact('ws', id);
        expect(entry!.description).toBe('Updated desc');

        // Verify JSONL has new entry appended
        const jsonl = fs.readFileSync(path.join(brainPath, 'workspaces', 'ws', 'artifacts.jsonl'), 'utf-8').trim();
        const lines = jsonl.split('\n');
        expect(lines.length).toBe(2); // original + update

        // Verify workspace.json summary refreshed
        const ws = storage.readWorkspace('ws');
        expect(ws!.artifacts[0].description).toBe('Updated desc');
      });
    });

    it('updates tags while preserving other fields', async () => {
      await withTempBrain(async (brainPath) => {
        const storage = new FileSystemWorkspaceStorage(brainPath);
        storage.createWorkspace('ws', 'Test');
        const id = storage.addArtifact('ws', 'doc-PLAN.md', '# Doc', { description: 'Original' });
        storage.updateArtifact('ws', id, { tags: ['new-tag'] });

        const entry = storage.readArtifact('ws', id);
        expect(entry!.tags).toEqual(['new-tag']);
        expect(entry!.description).toBe('Original');
        expect(entry!.type).toBe('plan');
      });
    });

    it('updates areas', async () => {
      await withTempBrain(async (brainPath) => {
        const storage = new FileSystemWorkspaceStorage(brainPath);
        storage.createWorkspace('ws', 'Test');
        const id = storage.addArtifact('ws', 'doc.md', '# Doc');
        storage.updateArtifact('ws', id, { areas: ['infra', 'networking'] });

        const entry = storage.readArtifact('ws', id);
        expect(entry!.areas).toEqual(['infra', 'networking']);
      });
    });

    it('throws ArtifactNotFoundError for non-existent ID', async () => {
      await withTempBrain(async (brainPath) => {
        const storage = new FileSystemWorkspaceStorage(brainPath);
        storage.createWorkspace('ws', 'Test');
        expect(() => storage.updateArtifact('ws', 'nonexistent', { description: 'x' }))
          .toThrow(ArtifactNotFoundError);
      });
    });

    it('ignores filename change in updates to prevent desync', async () => {
      await withTempBrain(async (brainPath) => {
        const storage = new FileSystemWorkspaceStorage(brainPath);
        storage.createWorkspace('ws', 'Test');
        const id = storage.addArtifact('ws', 'original.md', '# Original');
        storage.updateArtifact('ws', id, { filename: 'renamed.md' } as Partial<import('../../src/core/types.js').ArtifactEntry>);
        const entry = storage.readArtifact('ws', id);
        expect(entry!.filename).toBe('original.md');
        // File on disk should still be original.md
        expect(fs.existsSync(path.join(brainPath, 'workspaces', 'ws', 'docs', 'original.md'))).toBe(true);
      });
    });
  });

  describe('syncArtifacts', () => {
    it('returns empty results when no docs/ dir and no artifacts.jsonl', async () => {
      await withTempBrain(async (brainPath) => {
        const storage = new FileSystemWorkspaceStorage(brainPath);
        storage.createWorkspace('ws', 'Test');
        const result = storage.syncArtifacts('ws');
        expect(result.tracked).toEqual([]);
        expect(result.untracked).toEqual([]);
        expect(result.missing).toEqual([]);
      });
    });

    it('reports all files as tracked when all have metadata', async () => {
      await withTempBrain(async (brainPath) => {
        const storage = new FileSystemWorkspaceStorage(brainPath);
        storage.createWorkspace('ws', 'Test');
        storage.addArtifact('ws', 'one.md', '# One');
        storage.addArtifact('ws', 'two.md', '# Two');
        const result = storage.syncArtifacts('ws');
        expect(result.tracked).toHaveLength(2);
        expect(result.untracked).toEqual([]);
        expect(result.missing).toEqual([]);
      });
    });

    it('reports untracked .md files in docs/', async () => {
      await withTempBrain(async (brainPath) => {
        const storage = new FileSystemWorkspaceStorage(brainPath);
        storage.createWorkspace('ws', 'Test');
        const docsDir = path.join(brainPath, 'workspaces', 'ws', 'docs');
        fs.mkdirSync(docsDir, { recursive: true });
        fs.writeFileSync(path.join(docsDir, 'mystery.md'), '# Mystery');
        const result = storage.syncArtifacts('ws');
        expect(result.untracked).toEqual(['mystery.md']);
        expect(result.tracked).toEqual([]);
      });
    });

    it('ignores non-.md files in docs/', async () => {
      await withTempBrain(async (brainPath) => {
        const storage = new FileSystemWorkspaceStorage(brainPath);
        storage.createWorkspace('ws', 'Test');
        const docsDir = path.join(brainPath, 'workspaces', 'ws', 'docs');
        fs.mkdirSync(docsDir, { recursive: true });
        fs.writeFileSync(path.join(docsDir, 'script.sh'), '#!/bin/bash');
        const result = storage.syncArtifacts('ws');
        expect(result.untracked).toEqual([]);
      });
    });

    it('reports missing when metadata exists but file deleted', async () => {
      await withTempBrain(async (brainPath) => {
        const storage = new FileSystemWorkspaceStorage(brainPath);
        storage.createWorkspace('ws', 'Test');
        storage.addArtifact('ws', 'gone.md', '# Gone');
        fs.unlinkSync(path.join(brainPath, 'workspaces', 'ws', 'docs', 'gone.md'));
        const result = storage.syncArtifacts('ws');
        expect(result.missing).toHaveLength(1);
        expect(result.missing[0].filename).toBe('gone.md');
        expect(result.tracked).toEqual([]);
      });
    });

    it('handles mix of tracked, untracked, and missing', async () => {
      await withTempBrain(async (brainPath) => {
        const storage = new FileSystemWorkspaceStorage(brainPath);
        storage.createWorkspace('ws', 'Test');
        // tracked
        storage.addArtifact('ws', 'tracked.md', '# Tracked');
        // missing (metadata but no file)
        storage.addArtifact('ws', 'missing.md', '# Missing');
        fs.unlinkSync(path.join(brainPath, 'workspaces', 'ws', 'docs', 'missing.md'));
        // untracked (file but no metadata)
        fs.writeFileSync(path.join(brainPath, 'workspaces', 'ws', 'docs', 'untracked.md'), '# Untracked');

        const result = storage.syncArtifacts('ws');
        expect(result.tracked).toHaveLength(1);
        expect(result.tracked[0].filename).toBe('tracked.md');
        expect(result.untracked).toEqual(['untracked.md']);
        expect(result.missing).toHaveLength(1);
        expect(result.missing[0].filename).toBe('missing.md');
      });
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

  it('getActiveWorkspaceId with KB_SESSION_ID set + no session file + no .active returns null', async () => {
    await withTempBrain(async (brainPath) => {
      const sessionId = `test-${randomUUID()}`;
      process.env.KB_SESSION_ID = sessionId;

      const storage = new FileSystemWorkspaceStorage(brainPath);
      expect(storage.getActiveWorkspaceId()).toBeNull();
    });
  });

  it('getActiveWorkspaceId with KB_SESSION_ID set + no session file falls back to .active', async () => {
    await withTempBrain(async (brainPath) => {
      const sessionId = `test-${randomUUID()}`;
      process.env.KB_SESSION_ID = sessionId;
      const sessionFile = path.join(os.tmpdir(), `.mykb-session-${sessionId}`);

      try {
        const storage = new FileSystemWorkspaceStorage(brainPath);
        storage.createWorkspace('global-ws', 'Global');
        // .active is the global pointer; a session that hasn't run `kb work
        // start` (no session file) inherits it. See docs/session-isolation-DESIGN.md
        // "Update 2026-05-11" / GH issue #5.
        const activeFile = path.join(brainPath, 'workspaces', '.active');
        fs.writeFileSync(activeFile, 'global-ws\n');

        expect(storage.getActiveWorkspaceId()).toBe('global-ws');

        // Once this session sets its own workspace, the session file wins
        // and `.active` is untouched.
        storage.createWorkspace('session-ws', 'Session');
        storage.setActiveWorkspaceId('session-ws');
        expect(storage.getActiveWorkspaceId()).toBe('session-ws');
        expect(fs.readFileSync(activeFile, 'utf-8').trim()).toBe('global-ws');
      } finally {
        if (fs.existsSync(sessionFile)) fs.unlinkSync(sessionFile);
      }
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

  describe('handoff — writeHandoff / readHandoff / clearHandoff', () => {
    it('writeHandoff creates continuity.md with YAML frontmatter', async () => {
      await withTempBrain(async (brainPath) => {
        const storage = new FileSystemWorkspaceStorage(brainPath);
        storage.createWorkspace('proj', 'Project');
        storage.writeHandoff('proj', 'Working on step 3. Next: write tests.');

        const file = path.join(brainPath, 'workspaces', 'proj', 'continuity.md');
        expect(fs.existsSync(file)).toBe(true);

        const content = fs.readFileSync(file, 'utf-8');
        expect(content).toContain('---\nupdated:');
        expect(content).toContain('Working on step 3. Next: write tests.');
      });
    });

    it('readHandoff returns text and updated timestamp', async () => {
      await withTempBrain(async (brainPath) => {
        const storage = new FileSystemWorkspaceStorage(brainPath);
        storage.createWorkspace('proj', 'Project');
        storage.writeHandoff('proj', 'Implementing Phase 2.');

        const handoff = storage.readHandoff('proj');
        expect(handoff).not.toBeNull();
        expect(handoff!.text).toBe('Implementing Phase 2.');
        expect(handoff!.updated).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      });
    });

    it('readHandoff returns null when no continuity.md exists', async () => {
      await withTempBrain(async (brainPath) => {
        const storage = new FileSystemWorkspaceStorage(brainPath);
        storage.createWorkspace('proj', 'Project');

        const handoff = storage.readHandoff('proj');
        expect(handoff).toBeNull();
      });
    });

    it('writeHandoff overwrites previous content', async () => {
      await withTempBrain(async (brainPath) => {
        const storage = new FileSystemWorkspaceStorage(brainPath);
        storage.createWorkspace('proj', 'Project');
        storage.writeHandoff('proj', 'First handoff.');
        storage.writeHandoff('proj', 'Second handoff.');

        const handoff = storage.readHandoff('proj');
        expect(handoff!.text).toBe('Second handoff.');
      });
    });

    it('clearHandoff removes continuity.md', async () => {
      await withTempBrain(async (brainPath) => {
        const storage = new FileSystemWorkspaceStorage(brainPath);
        storage.createWorkspace('proj', 'Project');
        storage.writeHandoff('proj', 'Some context.');
        storage.clearHandoff('proj');

        const handoff = storage.readHandoff('proj');
        expect(handoff).toBeNull();

        const file = path.join(brainPath, 'workspaces', 'proj', 'continuity.md');
        expect(fs.existsSync(file)).toBe(false);
      });
    });

    it('clearHandoff is idempotent when no file exists', async () => {
      await withTempBrain(async (brainPath) => {
        const storage = new FileSystemWorkspaceStorage(brainPath);
        storage.createWorkspace('proj', 'Project');
        // Should not throw
        storage.clearHandoff('proj');
      });
    });

    it('writeHandoff throws for non-existent workspace', async () => {
      await withTempBrain(async (brainPath) => {
        const storage = new FileSystemWorkspaceStorage(brainPath);
        expect(() => storage.writeHandoff('ghost', 'text')).toThrow();
      });
    });

    it('writeHandoff preserves multi-line content', async () => {
      await withTempBrain(async (brainPath) => {
        const storage = new FileSystemWorkspaceStorage(brainPath);
        storage.createWorkspace('proj', 'Project');
        const multiLine = 'Line 1: doing X.\nLine 2: next Y.\nLine 3: blocked on Z.';
        storage.writeHandoff('proj', multiLine);

        const handoff = storage.readHandoff('proj');
        expect(handoff!.text).toBe(multiLine);
      });
    });

    it('writeHandoff updates timestamp on each write', async () => {
      await withTempBrain(async (brainPath) => {
        const storage = new FileSystemWorkspaceStorage(brainPath);
        storage.createWorkspace('proj', 'Project');
        storage.writeHandoff('proj', 'First.');
        const first = storage.readHandoff('proj')!.updated;

        // Small delay to ensure different timestamp
        await new Promise((r) => setTimeout(r, 10));
        storage.writeHandoff('proj', 'Second.');
        const second = storage.readHandoff('proj')!.updated;

        expect(second).not.toBe(first);
      });
    });
  });

  describe('resolveWorkspaceId', () => {
    it('returns exact match when ID matches', async () => {
      await withTempBrain(async (brainPath) => {
        const storage = new FileSystemWorkspaceStorage(brainPath);
        storage.createWorkspace('stark-picking', 'Stark Picking');
        expect(storage.resolveWorkspaceId('stark-picking')).toBe('stark-picking');
      });
    });

    it('returns single prefix match', async () => {
      await withTempBrain(async (brainPath) => {
        const storage = new FileSystemWorkspaceStorage(brainPath);
        storage.createWorkspace('stark-picking', 'Stark Picking');
        storage.createWorkspace('monitoring', 'Monitoring');
        expect(storage.resolveWorkspaceId('stark')).toBe('stark-picking');
      });
    });

    it('throws with candidates when multiple prefix matches', async () => {
      await withTempBrain(async (brainPath) => {
        const storage = new FileSystemWorkspaceStorage(brainPath);
        storage.createWorkspace('stark-picking', 'Stark Picking');
        storage.createWorkspace('stark-deploy', 'Stark Deploy');
        expect(() => storage.resolveWorkspaceId('stark')).toThrow(WorkspaceNotFoundError);
        expect(() => storage.resolveWorkspaceId('stark')).toThrow(/ambiguous/);
        expect(() => storage.resolveWorkspaceId('stark')).toThrow(/stark-picking/);
        expect(() => storage.resolveWorkspaceId('stark')).toThrow(/stark-deploy/);
      });
    });

    it('throws WorkspaceNotFoundError when no match', async () => {
      await withTempBrain(async (brainPath) => {
        const storage = new FileSystemWorkspaceStorage(brainPath);
        storage.createWorkspace('monitoring', 'Monitoring');
        expect(() => storage.resolveWorkspaceId('nonexistent')).toThrow(WorkspaceNotFoundError);
        expect(() => storage.resolveWorkspaceId('nonexistent')).toThrow(/not found/);
      });
    });

    it('prefers exact match over prefix match', async () => {
      await withTempBrain(async (brainPath) => {
        const storage = new FileSystemWorkspaceStorage(brainPath);
        storage.createWorkspace('stark', 'Stark');
        storage.createWorkspace('stark-picking', 'Stark Picking');
        expect(storage.resolveWorkspaceId('stark')).toBe('stark');
      });
    });
  });
});
