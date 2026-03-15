#!/usr/bin/env node

import { Command } from 'commander';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initBrain } from '../core/init.js';
import { resolveBrainPath, brainExists } from '../core/config.js';
import { MykbStore } from '../core/knowledge-store.js';
import { createArea, listAreas, updateAreaMetadata, deleteArea } from '../core/area.js';
import { renderMarkdown, renderJson, renderAreaIndex } from '../core/render.js';
import { save, saveAndPush } from '../core/save.js';
import { hydrateDatabase } from '../core/hydrate.js';
import { createDatabase } from '../core/db.js';
import { getAreaStats } from '../core/db.js';
import { Zone, ProvenanceStatus } from '../core/types.js';
import type {
  EntryFilter,
  AddFactOptions,
  AddDecisionOptions,
  AddGotchaOptions,
} from '../core/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readVersion(): string {
  // Walk up to find package.json
  let dir = __dirname;
  for (let i = 0; i < 5; i++) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { version: string };
      return pkg.version;
    }
    dir = path.dirname(dir);
  }
  return '0.0.0';
}

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

const program = new Command();

program
  .name('kb')
  .description('Knowledge management CLI for AI coding agents')
  .version(readVersion());

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
      const entries = store.loadArea(area);
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
        const entries = store.loadArea(area);
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
        const entries = store.loadArea(area);
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
      const entries = store.loadArea(area);
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
        const entries = store.loadArea(area);
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
  .option('--tag <tag>', 'Filter by tag')
  .option('--json', 'Output as JSON')
  .action((area: string, opts: { zone?: string; tag?: string; json?: boolean }) => {
    withStore((store) => {
      const filter: EntryFilter = {};
      if (opts.zone) filter.zone = opts.zone as Zone;
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
  .action((query: string) => {
    withStore((store) => {
      const entries = store.search(query);
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

program.parse();
