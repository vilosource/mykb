#!/usr/bin/env node

import { Command } from 'commander';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readVersion } from './version.js';
import { initBrain } from '../core/init.js';
import { resolveBrainPath, brainExists } from '../core/config.js';
import { MykbStore } from '../core/knowledge-store.js';
import { createArea, listAreas, readAreaMetadata, updateAreaMetadata, deleteArea } from '../core/area.js';
import { renderMarkdown, renderJson, renderAreaIndex, renderWorkspace } from '../core/render.js';
import { FileSystemWorkspaceStorage } from '../core/workspace.js';
import type { WorkspaceState } from '../core/types.js';
import { save, saveAndPush } from '../core/save.js';
import { hydrateDatabase } from '../core/hydrate.js';
import { createDatabase } from '../core/db.js';
import { getAreaStats } from '../core/db.js';
import { Zone, ProvenanceStatus } from '../core/types.js';
import type {
  AreaContext,
  EntryFilter,
  AddFactOptions,
  AddDecisionOptions,
  AddGotchaOptions,
} from '../core/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getBrainPath(): string {
  return resolveBrainPath();
}

function requireBrain(): string {
  const bp = getBrainPath();
  if (!brainExists(bp)) {
    process.stderr.write(`Error: brain not initialized at ${bp}. Run 'kb init' first.\n`);
    process.exit(1);
  }
  return bp;
}

function withStore<T>(fn: (store: MykbStore) => T): T {
  const bp = requireBrain();
  const store = MykbStore.open(bp);
  try {
    return fn(store);
  } finally {
    store.close();
  }
}

function createWorkspaceStorage(): FileSystemWorkspaceStorage {
  const bp = requireBrain();
  return new FileSystemWorkspaceStorage(bp);
}

function requireActiveWorkspace(storage: FileSystemWorkspaceStorage): string {
  const activeId = storage.getActiveWorkspaceId();
  if (!activeId) {
    process.stderr.write('Error: no active workspace. Run "kb work start <id>" first.\n');
    process.exit(1);
  }
  return activeId;
}

const program = new Command();

program
  .name('kb')
  .description('Knowledge management CLI for AI coding agents')
  .version(readVersion(__dirname));

// --- init ---
const initCmd = program.command('init').description('Initialize a new brain');

initCmd.action(() => {
  const bp = getBrainPath();
  if (brainExists(bp) && fs.existsSync(path.join(bp, 'manifest.json'))) {
    process.stderr.write(`Error: brain already initialized at ${bp}\n`);
    process.exit(1);
  }
  initBrain(bp);
  console.log(`Brain initialized at ${bp}`);
});

initCmd
  .command('area <id> <name> [summary]')
  .description('Create a new area')
  .action((id: string, name: string, summary?: string) => {
    const bp = requireBrain();
    createArea(bp, id, name, summary ?? '');
    console.log(`Area '${id}' created`);
  });

// --- add ---
const addCmd = program.command('add').description('Add a knowledge entry');

addCmd
  .command('fact <area> <text>')
  .description('Add a fact')
  .option('--source <source>', 'Source of the fact')
  .option('--tags <tags>', 'Comma-separated tags')
  .option('--zone <zone>', 'Zone (active, established, archive)')
  .option('--unverified', 'Mark as unverified (default)')
  .action((area: string, text: string, opts: { source?: string; tags?: string; zone?: string }) => {
    withStore((store) => {
      const options: AddFactOptions = {};
      if (opts.tags) options.tags = opts.tags.split(',').map((t) => t.trim());
      if (opts.zone) options.zone = opts.zone as Zone;
      if (opts.source)
        options.provenance = { status: ProvenanceStatus.Unverified, source: opts.source };
      const id = store.addFact(area, text, options);
      const entries = store.loadArea(area, { excludeZone: Zone.Archive });
      const counts = countTypes(entries);
      console.log(`added fact ${id} to ${area} (${counts})`);
    });
  });

addCmd
  .command('decision <area> <text>')
  .description('Add a decision')
  .option('--source <source>', 'Source')
  .option('--why <why>', 'Reason for the decision')
  .option('--rejected <rejected>', 'Rejected alternatives')
  .option('--context <context>', 'Context')
  .option('--tags <tags>', 'Comma-separated tags')
  .option('--zone <zone>', 'Zone')
  .action(
    (
      area: string,
      text: string,
      opts: {
        source?: string;
        why?: string;
        rejected?: string;
        context?: string;
        tags?: string;
        zone?: string;
      },
    ) => {
      withStore((store) => {
        const options: AddDecisionOptions = {};
        if (opts.tags) options.tags = opts.tags.split(',').map((t) => t.trim());
        if (opts.zone) options.zone = opts.zone as Zone;
        if (opts.source)
          options.provenance = { status: ProvenanceStatus.Unverified, source: opts.source };
        if (opts.why) options.why = opts.why;
        if (opts.rejected) options.rejected = opts.rejected;
        if (opts.context) options.context = opts.context;
        const id = store.addDecision(area, text, options);
        const entries = store.loadArea(area, { excludeZone: Zone.Archive });
        const counts = countTypes(entries);
        console.log(`added decision ${id} to ${area} (${counts})`);
      });
    },
  );

addCmd
  .command('gotcha <area> <text>')
  .description('Add a gotcha')
  .option('--source <source>', 'Source')
  .option('--failed', 'Mark as failed')
  .option('--tags <tags>', 'Comma-separated tags')
  .option('--zone <zone>', 'Zone')
  .action(
    (
      area: string,
      text: string,
      opts: { source?: string; failed?: boolean; tags?: string; zone?: string },
    ) => {
      withStore((store) => {
        const options: AddGotchaOptions = {};
        if (opts.tags) options.tags = opts.tags.split(',').map((t) => t.trim());
        if (opts.zone) options.zone = opts.zone as Zone;
        if (opts.source)
          options.provenance = { status: ProvenanceStatus.Unverified, source: opts.source };
        if (opts.failed) options.failed = true;
        const id = store.addGotcha(area, text, options);
        const entries = store.loadArea(area, { excludeZone: Zone.Archive });
        const counts = countTypes(entries);
        console.log(`added gotcha ${id} to ${area} (${counts})`);
      });
    },
  );

addCmd
  .command('pattern <area> <text>')
  .description('Add a pattern')
  .option('--source <source>', 'Source')
  .option('--tags <tags>', 'Comma-separated tags')
  .option('--zone <zone>', 'Zone')
  .action((area: string, text: string, opts: { source?: string; tags?: string; zone?: string }) => {
    withStore((store) => {
      const options: AddFactOptions = {};
      if (opts.tags) options.tags = opts.tags.split(',').map((t) => t.trim());
      if (opts.zone) options.zone = opts.zone as Zone;
      if (opts.source)
        options.provenance = { status: ProvenanceStatus.Unverified, source: opts.source };
      const id = store.addPattern(area, text, options);
      const entries = store.loadArea(area, { excludeZone: Zone.Archive });
      const counts = countTypes(entries);
      console.log(`added pattern ${id} to ${area} (${counts})`);
    });
  });

addCmd
  .command('link <area> <text> <url>')
  .description('Add a link')
  .option('--source <source>', 'Source')
  .option('--tags <tags>', 'Comma-separated tags')
  .option('--zone <zone>', 'Zone')
  .action(
    (
      area: string,
      text: string,
      url: string,
      opts: { source?: string; tags?: string; zone?: string },
    ) => {
      withStore((store) => {
        const options: AddFactOptions = {};
        if (opts.tags) options.tags = opts.tags.split(',').map((t) => t.trim());
        if (opts.zone) options.zone = opts.zone as Zone;
        if (opts.source)
          options.provenance = { status: ProvenanceStatus.Unverified, source: opts.source };
        const id = store.addLink(area, text, url, options);
        const entries = store.loadArea(area, { excludeZone: Zone.Archive });
        const counts = countTypes(entries);
        console.log(`added link ${id} to ${area} (${counts})`);
      });
    },
  );

// --- load ---
program
  .command('load <area>')
  .description('Load entries from an area')
  .option('--zone <zone>', 'Filter by zone')
  .option('--all', 'Include archived entries')
  .option('--tag <tag>', 'Filter by tag')
  .option('--json', 'Output as JSON')
  .action((area: string, opts: { zone?: string; all?: boolean; tag?: string; json?: boolean }) => {
    withStore((store) => {
      const filter: EntryFilter = {};
      if (opts.zone) filter.zone = opts.zone as Zone;
      else if (!opts.all) filter.excludeZone = Zone.Archive;
      if (opts.tag) filter.tags = [opts.tag];
      const entries = store.loadArea(area, filter);
      if (opts.json) {
        console.log(renderJson(entries));
      } else {
        const output = renderMarkdown(entries);
        if (output) process.stdout.write(output);
      }
    });
  });

// --- list ---
program
  .command('list')
  .description('List all areas')
  .option('--json', 'Output as JSON')
  .action((opts: { json?: boolean }) => {
    const bp = requireBrain();
    const areas = listAreas(bp);
    if (opts.json) {
      console.log(JSON.stringify(areas, null, 2));
    } else {
      const output = renderAreaIndex(areas);
      if (output) process.stdout.write(output);
    }
  });

// --- search ---
program
  .command('search <query>')
  .description('Full-text search across all areas')
  .option('--all', 'Include archived entries')
  .action((query: string, opts: { all?: boolean }) => {
    withStore((store) => {
      const excludeZone = opts.all ? undefined : Zone.Archive;
      const entries = store.search(query, excludeZone);
      const output = renderMarkdown(entries);
      if (output) process.stdout.write(output);
    });
  });

// --- match ---
program
  .command('match <text>')
  .description('Find relevant areas for text')
  .action((text: string) => {
    withStore((store) => {
      const matches = store.matchAreas(text);
      for (const m of matches) {
        console.log(`${m.area}\t${m.score.toFixed(2)}`);
      }
    });
  });

// --- save ---
program
  .command('save')
  .description('Commit changes to git')
  .option('--push', 'Push after saving')
  .option('--message <message>', 'Custom commit message')
  .action((opts: { push?: boolean; message?: string }) => {
    const bp = requireBrain();
    if (opts.push) {
      saveAndPush(bp, opts.message);
      console.log('saved and pushed');
    } else {
      // Check if there are changes first
      const status = execSync('git status --porcelain', { cwd: bp, encoding: 'utf-8' }).trim();
      if (status.length === 0) {
        console.log('nothing to save');
        return;
      }
      save(bp, opts.message);
      console.log('saved');
    }
  });

// --- verify ---
program
  .command('verify <area> <id>')
  .description('Mark an entry as verified')
  .action((area: string, id: string) => {
    withStore((store) => {
      store.verifyEntry(area, id);
      console.log(`verified ${id} in ${area}`);
    });
  });

// --- promote ---
program
  .command('promote <area> <id>')
  .description('Promote an entry to established zone')
  .action((area: string, id: string) => {
    withStore((store) => {
      store.promoteEntry(area, id);
      console.log(`promoted ${id} in ${area}`);
    });
  });

// --- archive ---
program
  .command('archive <area> <id>')
  .description('Archive an entry')
  .action((area: string, id: string) => {
    withStore((store) => {
      store.archiveEntry(area, id);
      console.log(`archived ${id} in ${area}`);
    });
  });

// --- delete ---
program
  .command('delete <area> <id>')
  .description('Delete an entry')
  .action((area: string, id: string) => {
    withStore((store) => {
      store.deleteEntry(area, id);
      console.log(`deleted ${id} from ${area}`);
    });
  });

// --- update ---
program
  .command('update <area> <id>')
  .description('Update an entry')
  .option('--text <text>', 'New text')
  .option('--tags <tags>', 'New comma-separated tags')
  .option('--zone <zone>', 'New zone')
  .option('--source <source>', 'New source')
  .action(
    (
      area: string,
      id: string,
      opts: { text?: string; tags?: string; zone?: string; source?: string },
    ) => {
      withStore((store) => {
        const updates: Record<string, unknown> = {};
        if (opts.text) updates.text = opts.text;
        if (opts.tags) updates.tags = opts.tags.split(',').map((t) => t.trim());
        if (opts.zone) updates.zone = opts.zone;
        if (opts.source)
          updates.provenance = { status: ProvenanceStatus.Unverified, source: opts.source };
        store.updateEntry(area, id, updates);
        console.log(`updated ${id} in ${area}`);
      });
    },
  );

// --- area ---
const areaCmd = program.command('area').description('Area management');

areaCmd
  .command('update <id>')
  .description('Update area metadata')
  .option('--summary <summary>', 'New summary')
  .option('--owner <owner>', 'New owner')
  .action((id: string, opts: { summary?: string; owner?: string }) => {
    const bp = requireBrain();
    const updates: Record<string, string> = {};
    if (opts.summary) updates.summary = opts.summary;
    if (opts.owner) updates.owner = opts.owner;
    updateAreaMetadata(bp, id, updates);
    console.log(`updated area '${id}'`);
  });

areaCmd
  .command('delete <id>')
  .description('Delete an area')
  .action((id: string) => {
    const bp = requireBrain();
    deleteArea(bp, id);
    console.log(`deleted area '${id}'`);
  });

// --- stats ---
program
  .command('stats')
  .description('Show entry counts by area')
  .action(() => {
    const bp = requireBrain();
    const dbPath = path.join(bp, 'kb.db');
    const db = createDatabase(dbPath);
    try {
      const areas = listAreas(bp);
      for (const area of areas) {
        const stats = getAreaStats(db, area.id);
        const parts: string[] = [];
        if (stats.facts > 0) parts.push(`${stats.facts} fact${stats.facts !== 1 ? 's' : ''}`);
        if (stats.decisions > 0)
          parts.push(`${stats.decisions} decision${stats.decisions !== 1 ? 's' : ''}`);
        if (stats.gotchas > 0)
          parts.push(`${stats.gotchas} gotcha${stats.gotchas !== 1 ? 's' : ''}`);
        if (stats.patterns > 0)
          parts.push(`${stats.patterns} pattern${stats.patterns !== 1 ? 's' : ''}`);
        if (stats.links > 0) parts.push(`${stats.links} link${stats.links !== 1 ? 's' : ''}`);
        console.log(`${area.id}: ${parts.length > 0 ? parts.join(', ') : 'empty'}`);
      }
    } finally {
      db.close();
    }
  });

// --- stale ---
program
  .command('stale')
  .description('List facts past freshness threshold')
  .option('--days <days>', 'Days threshold', '30')
  .action((opts: { days: string }) => {
    withStore((store) => {
      const threshold = parseInt(opts.days, 10);
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - threshold);
      const cutoffIso = cutoff.toISOString();

      // Search for verified entries whose verification date is old
      const bp = requireBrain();
      const areas = listAreas(bp);
      const staleEntries = [];
      for (const area of areas) {
        const entries = store.loadArea(area.id);
        for (const entry of entries) {
          if (
            entry.provenance.status === ProvenanceStatus.Verified &&
            entry.provenance.date &&
            entry.provenance.date < cutoffIso
          ) {
            staleEntries.push(entry);
          }
        }
      }
      const output = renderMarkdown(staleEntries);
      if (output) process.stdout.write(output);
    });
  });

// --- compact ---
program
  .command('compact [area]')
  .description('Compact JSONL files')
  .action((area?: string) => {
    withStore((store) => {
      store.compact(area);
      console.log(`compacted ${area ?? 'all areas'}`);
    });
  });

// --- rebuild ---
program
  .command('rebuild')
  .description('Rebuild SQLite database from JSONL files')
  .action(() => {
    const bp = requireBrain();
    const dbPath = path.join(bp, 'kb.db');
    // Remove existing db files
    for (const ext of ['', '-wal', '-shm']) {
      const p = dbPath + ext;
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    // Recreate and hydrate
    const db = createDatabase(dbPath);
    hydrateDatabase(db, bp);
    db.close();
    console.log('database rebuilt');
  });

// --- export ---
const exportCmd = program.command('export').description('Export data');

exportCmd
  .command('agents-md')
  .description('Export area index as markdown')
  .action(() => {
    const bp = requireBrain();
    const areas = listAreas(bp);
    const output = renderAreaIndex(areas);
    if (output) process.stdout.write(output);
  });

// Helper function
function countTypes(entries: { type: string }[]): string {
  const counts: Record<string, number> = {};
  for (const e of entries) {
    counts[e.type] = (counts[e.type] ?? 0) + 1;
  }
  return Object.entries(counts)
    .map(([type, count]) => `${count} ${type}${count !== 1 ? 's' : ''}`)
    .join(', ');
}

function fetchAreaContexts(areaIds: string[]): AreaContext[] {
  if (areaIds.length === 0) return [];
  const bp = requireBrain();
  const dbPath = path.join(bp, 'kb.db');
  const db = createDatabase(dbPath);
  try {
    const contexts: AreaContext[] = [];
    for (const areaId of areaIds) {
      const metadata = readAreaMetadata(bp, areaId);
      if (metadata) {
        const stats = getAreaStats(db, areaId);
        contexts.push({ id: areaId, summary: metadata.summary, stats });
      }
    }
    return contexts;
  } finally {
    db.close();
  }
}

// --- work (workspace management) ---
const workCmd = program.command('work').description('Workspace management');

workCmd
  .command('create <id> <name>')
  .description('Create a new workspace')
  .option('--areas <areas>', 'Comma-separated area IDs')
  .option('--jira <key>', 'JIRA ticket key')
  .option('--wiki <url>', 'Wiki URL')
  .option('--repos <repos>', 'Comma-separated repo paths')
  .action(
    (
      id: string,
      name: string,
      opts: { areas?: string; jira?: string; wiki?: string; repos?: string },
    ) => {
      const storage = createWorkspaceStorage();
      const areas = opts.areas ? opts.areas.split(',').map((a) => a.trim()) : undefined;
      const links: Record<string, unknown> = {};
      if (opts.jira) links.jira = opts.jira;
      if (opts.wiki) links.wiki = opts.wiki;
      if (opts.repos) links.repos = opts.repos.split(',').map((r) => r.trim());
      storage.createWorkspace(id, name, {
        areas,
        links: Object.keys(links).length > 0 ? (links as { jira?: string; wiki?: string; repos?: string[] }) : undefined,
      });
      console.log(`Workspace '${id}' created`);
    },
  );

workCmd
  .command('start <id>')
  .description('Set active workspace')
  .action((id: string) => {
    const storage = createWorkspaceStorage();
    const ws = storage.readWorkspace(id);
    if (!ws) {
      process.stderr.write(`Error: workspace '${id}' not found.\n`);
      process.exit(1);
    }
    storage.setActiveWorkspaceId(id);

    // Auto-sync: register untracked .md files in docs/
    const syncResult = storage.syncArtifacts(id);
    if (syncResult.untracked.length > 0) {
      const docsDir = path.join(resolveBrainPath(), 'workspaces', id, 'docs');
      for (const f of syncResult.untracked) {
        const content = fs.readFileSync(path.join(docsDir, f), 'utf-8');
        storage.addArtifact(id, f, content);
      }
    }

    // Re-read workspace to get updated artifacts
    const updated = storage.readWorkspace(id)!;
    const journal = storage.readJournal(id, 3);
    const areaContexts = fetchAreaContexts(updated.areas);
    process.stdout.write(renderWorkspace(updated, journal, areaContexts));
  });

workCmd
  .command('stop')
  .description('Clear active workspace')
  .action(() => {
    const storage = createWorkspaceStorage();
    storage.clearActiveWorkspaceId();
    console.log('Workspace stopped');
  });

workCmd
  .command('state')
  .description('Update active workspace state')
  .option('--phase <phase>', 'Current phase')
  .option('--active <active>', 'What is currently active')
  .option('--blocked <blocked>', 'What is blocked')
  .option('--next <next>', 'What is next')
  .action((opts: { phase?: string; active?: string; blocked?: string; next?: string }) => {
    const storage = createWorkspaceStorage();
    const activeId = requireActiveWorkspace(storage);
    const state: Partial<WorkspaceState> = {};
    if (opts.phase !== undefined) state.phase = opts.phase;
    if (opts.active !== undefined) state.active = opts.active;
    if (opts.blocked !== undefined) state.blocked = opts.blocked;
    if (opts.next !== undefined) state.next = opts.next;
    storage.updateWorkspaceState(activeId, state);
    console.log(`Workspace '${activeId}' state updated`);
  });

workCmd
  .command('journal [text]')
  .description('Append or show journal entries')
  .option('--show [count]', 'Show last N journal entries')
  .action((text: string | undefined, opts: { show?: boolean | string }) => {
    const storage = createWorkspaceStorage();
    const activeId = requireActiveWorkspace(storage);

    if (opts.show !== undefined) {
      // Show mode
      const limit = typeof opts.show === 'string' ? parseInt(opts.show, 10) : 5;
      const entries = storage.readJournal(activeId, limit);
      if (entries.length === 0) {
        console.log('No journal entries');
        return;
      }
      for (const entry of entries) {
        const dateStr = entry.date.split('T')[0];
        console.log(`- ${dateStr}: ${entry.text}`);
      }
      return;
    }

    if (!text) {
      process.stderr.write('Error: provide text or use --show\n');
      process.exit(1);
    }

    storage.appendJournal(activeId, text);
    console.log(`Journal entry added to '${activeId}'`);
  });

workCmd
  .command('note [text]')
  .description('Add, list, or delete workspace notes')
  .option('--tags <tags>', 'Comma-separated tags (e.g. bug,ux)')
  .option('--tag <tag>', 'Filter notes by tag')
  .option('--delete <id>', 'Delete a note by ID')
  .action((text: string | undefined, opts: { tags?: string; tag?: string; delete?: string }) => {
    const storage = createWorkspaceStorage();
    const activeId = requireActiveWorkspace(storage);

    if (opts.delete) {
      storage.deleteNote(activeId, opts.delete);
      console.log(`Note '${opts.delete}' deleted`);
      return;
    }

    if (!text) {
      // List mode
      const notes = storage.readNotes(activeId, opts.tag);
      if (notes.length === 0) {
        console.log(opts.tag ? `No notes with tag '${opts.tag}'` : 'No notes');
        return;
      }
      for (const note of notes) {
        const dateStr = note.date.split('T')[0];
        const tagStr = note.tags.length > 0 ? ` [${note.tags.join(', ')}]` : '';
        console.log(`- ${note.id}  ${dateStr}${tagStr}: ${note.text}`);
      }
      return;
    }

    const tags = opts.tags ? opts.tags.split(',').map((t) => t.trim()).filter(Boolean) : [];
    const noteId = storage.appendNote(activeId, text, tags);
    const tagStr = tags.length > 0 ? ` [${tags.join(', ')}]` : '';
    console.log(`Note added to '${activeId}'${tagStr} (${noteId})`);
  });

workCmd
  .command('notes')
  .description('List workspace notes (shorthand for: work note --tag)')
  .option('--tag <tag>', 'Filter notes by tag')
  .action((opts: { tag?: string }) => {
    const storage = createWorkspaceStorage();
    const activeId = requireActiveWorkspace(storage);

    const notes = storage.readNotes(activeId, opts.tag);
    if (notes.length === 0) {
      console.log(opts.tag ? `No notes with tag '${opts.tag}'` : 'No notes');
      return;
    }
    for (const note of notes) {
      const dateStr = note.date.split('T')[0];
      const tagStr = note.tags.length > 0 ? ` [${note.tags.join(', ')}]` : '';
      console.log(`- ${note.id}  ${dateStr}${tagStr}: ${note.text}`);
    }
  });

workCmd
  .command('link <area>')
  .description('Link an area to active workspace')
  .action((area: string) => {
    const storage = createWorkspaceStorage();
    const activeId = requireActiveWorkspace(storage);
    storage.linkArea(activeId, area);
    console.log(`Area '${area}' linked to '${activeId}'`);
  });

workCmd
  .command('unlink <area>')
  .description('Unlink an area from active workspace')
  .action((area: string) => {
    const storage = createWorkspaceStorage();
    const activeId = requireActiveWorkspace(storage);
    storage.unlinkArea(activeId, area);
    console.log(`Area '${area}' unlinked from '${activeId}'`);
  });

workCmd
  .command('list')
  .description('List all workspaces')
  .action(() => {
    const storage = createWorkspaceStorage();
    const workspaces = storage.listWorkspaces();
    if (workspaces.length === 0) {
      console.log('No workspaces found');
      return;
    }
    const activeId = storage.getActiveWorkspaceId();
    for (const ws of workspaces) {
      const marker = ws.id === activeId ? ' *' : '';
      console.log(`${ws.id}\t${ws.name}${marker}`);
    }
  });

workCmd
  .command('show [id]')
  .description('Show workspace details')
  .action((id?: string) => {
    const storage = createWorkspaceStorage();
    const wsId = id ?? storage.getActiveWorkspaceId();
    if (!wsId) {
      process.stderr.write('Error: no active workspace. Provide an id or run "kb work start <id>".\n');
      process.exit(1);
    }
    const ws = storage.readWorkspace(wsId);
    if (!ws) {
      process.stderr.write(`Error: workspace '${wsId}' not found.\n`);
      process.exit(1);
    }
    const journal = storage.readJournal(wsId, 5);
    const areaContexts = fetchAreaContexts(ws.areas);
    process.stdout.write(renderWorkspace(ws, journal, areaContexts));
  });

workCmd
  .command('archive <id>')
  .description('Archive a workspace')
  .action((id: string) => {
    const storage = createWorkspaceStorage();
    const activeId = storage.getActiveWorkspaceId();
    storage.archiveWorkspace(id);
    if (activeId === id) {
      storage.clearActiveWorkspaceId();
    }
    console.log(`Workspace '${id}' archived`);
  });

// --- Workspace Artifacts (wsa) ---

const wsaCmd = program.command('wsa').description('Workspace artifacts');

wsaCmd
  .command('add <filename>')
  .description('Add/register a workspace artifact')
  .option('--from <path>', 'Copy file from path into docs/')
  .option('--desc <description>', 'One-line description')
  .option('--type <type>', 'Artifact type (plan, design, analysis, report, notes, prompt, other)')
  .option('--tags <tags>', 'Comma-separated tags')
  .option('--areas <areas>', 'Comma-separated area IDs')
  .action(
    (
      filename: string,
      opts: { from?: string; desc?: string; type?: string; tags?: string; areas?: string },
    ) => {
      const storage = createWorkspaceStorage();
      const activeId = requireActiveWorkspace(storage);
      const docsDir = path.join(resolveBrainPath(), 'workspaces', activeId, 'docs');

      let content: string;
      if (opts.from) {
        if (!fs.existsSync(opts.from)) {
          process.stderr.write(`Error: File not found: ${opts.from}\n`);
          process.exit(1);
        }
        content = fs.readFileSync(opts.from, 'utf-8');
      } else if (fs.existsSync(path.join(docsDir, filename))) {
        content = fs.readFileSync(path.join(docsDir, filename), 'utf-8');
      } else {
        // Read from stdin
        content = fs.readFileSync(0, 'utf-8');
      }

      try {
        const id = storage.addArtifact(activeId, filename, content, {
          type: opts.type as import('../core/types.js').ArtifactType | undefined,
          description: opts.desc,
          tags: opts.tags ? opts.tags.split(',').map((t) => t.trim()) : undefined,
          areas: opts.areas ? opts.areas.split(',').map((a) => a.trim()) : undefined,
        });
        console.log(`Artifact added: ${id} ${filename}`);
      } catch (e: unknown) {
        process.stderr.write(`Error: ${(e as Error).message}\n`);
        process.exit(1);
      }
    },
  );

wsaCmd
  .command('list')
  .description('List workspace artifacts')
  .action(() => {
    const storage = createWorkspaceStorage();
    const activeId = requireActiveWorkspace(storage);
    const artifacts = storage.listArtifacts(activeId);

    if (artifacts.length === 0) {
      console.log('No artifacts in this workspace.');
      return;
    }

    const maxType = Math.max(...artifacts.map((a) => a.type.length));
    for (const a of artifacts) {
      const typePadded = a.type.padEnd(maxType);
      if (a.description) {
        console.log(`${a.id}  ${typePadded}  ${a.filename} — ${a.description}`);
      } else {
        console.log(`${a.id}  ${typePadded}  ${a.filename}`);
      }
    }
  });

wsaCmd
  .command('show <artifact>')
  .description('Show full artifact content')
  .action((artifact: string) => {
    const storage = createWorkspaceStorage();
    const activeId = requireActiveWorkspace(storage);
    const content = storage.readArtifactContent(activeId, artifact);

    if (content === null) {
      process.stderr.write(`Error: Artifact '${artifact}' not found. Run kb wsa list to see available artifacts.\n`);
      process.exit(1);
    }

    process.stdout.write(content);
  });

wsaCmd
  .command('meta <artifact>')
  .description('Show artifact metadata')
  .action((artifact: string) => {
    const storage = createWorkspaceStorage();
    const activeId = requireActiveWorkspace(storage);
    const entry = storage.readArtifact(activeId, artifact);

    if (!entry) {
      process.stderr.write(`Error: Artifact '${artifact}' not found. Run kb wsa list to see available artifacts.\n`);
      process.exit(1);
    }

    console.log(`ID:          ${entry.id}`);
    console.log(`Filename:    ${entry.filename}`);
    console.log(`Type:        ${entry.type}`);
    console.log(`Description: ${entry.description || '(none)'}`);
    console.log(`Tags:        ${entry.tags.length > 0 ? entry.tags.join(', ') : '(none)'}`);
    console.log(`Areas:       ${entry.areas.length > 0 ? entry.areas.join(', ') : '(none)'}`);
    console.log(`Created:     ${entry.created}`);
    console.log(`Updated:     ${entry.updated}`);
  });

wsaCmd
  .command('update <artifact>')
  .description('Update artifact metadata')
  .option('--desc <description>', 'Update description')
  .option('--type <type>', 'Update type')
  .option('--tags <tags>', 'Update tags (comma-separated)')
  .option('--areas <areas>', 'Update areas (comma-separated)')
  .action(
    (artifact: string, opts: { desc?: string; type?: string; tags?: string; areas?: string }) => {
      const storage = createWorkspaceStorage();
      const activeId = requireActiveWorkspace(storage);

      const updates: Record<string, unknown> = {};
      if (opts.desc !== undefined) updates.description = opts.desc;
      if (opts.type !== undefined) updates.type = opts.type;
      if (opts.tags !== undefined) updates.tags = opts.tags.split(',').map((t) => t.trim());
      if (opts.areas !== undefined) updates.areas = opts.areas.split(',').map((a) => a.trim());

      try {
        storage.updateArtifact(activeId, artifact, updates as Partial<import('../core/types.js').ArtifactEntry>);
        console.log('Artifact updated.');
      } catch (e: unknown) {
        process.stderr.write(`Error: ${(e as Error).message}\n`);
        process.exit(1);
      }
    },
  );

wsaCmd
  .command('delete <artifact>')
  .description('Delete a workspace artifact')
  .action((artifact: string) => {
    const storage = createWorkspaceStorage();
    const activeId = requireActiveWorkspace(storage);

    try {
      storage.deleteArtifact(activeId, artifact);
      console.log('Artifact deleted.');
    } catch (e: unknown) {
      process.stderr.write(`Error: ${(e as Error).message}\n`);
      process.exit(1);
    }
  });

wsaCmd
  .command('sync')
  .description('Reconcile docs/ with artifact metadata')
  .option('--fix', 'Auto-register untracked files')
  .action((opts: { fix?: boolean }) => {
    const storage = createWorkspaceStorage();
    const activeId = requireActiveWorkspace(storage);
    const result = storage.syncArtifacts(activeId);

    if (result.tracked.length > 0) {
      console.log(`Tracked: ${result.tracked.length} artifact(s)`);
    }

    if (result.untracked.length > 0) {
      console.log('Untracked files:');
      for (const f of result.untracked) {
        console.log(`  ${f}`);
      }

      if (opts.fix) {
        const docsDir = path.join(resolveBrainPath(), 'workspaces', activeId, 'docs');
        for (const f of result.untracked) {
          const content = fs.readFileSync(path.join(docsDir, f), 'utf-8');
          storage.addArtifact(activeId, f, content);
        }
        console.log(`Registered ${result.untracked.length} untracked file(s).`);
      }
    }

    if (result.missing.length > 0) {
      console.log('Missing files (metadata exists, file deleted):');
      for (const a of result.missing) {
        console.log(`  ${a.id}  ${a.filename}`);
      }
    }

    if (result.tracked.length === 0 && result.untracked.length === 0 && result.missing.length === 0) {
      console.log('No artifacts to sync.');
    }
  });

wsaCmd
  .command('link <artifact> <area>')
  .description('Link artifact to a knowledge area')
  .action((artifact: string, area: string) => {
    const storage = createWorkspaceStorage();
    const activeId = requireActiveWorkspace(storage);
    const entry = storage.readArtifact(activeId, artifact);

    if (!entry) {
      process.stderr.write(`Error: Artifact '${artifact}' not found.\n`);
      process.exit(1);
    }

    if (!entry.areas.includes(area)) {
      storage.updateArtifact(activeId, entry.id, { areas: [...entry.areas, area] });
    }
    console.log(`Artifact linked to area '${area}'.`);
  });

wsaCmd
  .command('unlink <artifact> <area>')
  .description('Unlink artifact from a knowledge area')
  .action((artifact: string, area: string) => {
    const storage = createWorkspaceStorage();
    const activeId = requireActiveWorkspace(storage);
    const entry = storage.readArtifact(activeId, artifact);

    if (!entry) {
      process.stderr.write(`Error: Artifact '${artifact}' not found.\n`);
      process.exit(1);
    }

    storage.updateArtifact(activeId, entry.id, { areas: entry.areas.filter((a) => a !== area) });
    console.log(`Artifact unlinked from area '${area}'.`);
  });

wsaCmd
  .command('search <query>')
  .description('Search artifact content')
  .action((query: string) => {
    const storage = createWorkspaceStorage();
    const activeId = requireActiveWorkspace(storage);
    const docsDir = path.join(resolveBrainPath(), 'workspaces', activeId, 'docs');

    if (!fs.existsSync(docsDir)) {
      console.log('No artifacts to search.');
      return;
    }

    const files = fs.readdirSync(docsDir).filter((f) => f.endsWith('.md'));
    let found = false;

    for (const file of files) {
      const content = fs.readFileSync(path.join(docsDir, file), 'utf-8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(query)) {
          console.log(`${file}:${i + 1}: ${lines[i]}`);
          found = true;
        }
      }
    }

    if (!found) {
      console.log('No matches found.');
    }
  });

program.parse();
