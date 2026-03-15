import type Database from 'better-sqlite3';
import path from 'node:path';
import {
  createDatabase,
  upsertEntry as dbUpsert,
  deleteEntry as dbDelete,
  queryEntries,
  searchEntries,
} from './db.js';
import { appendEntry, writeTombstone, compactEntries } from './store.js';
import { ensureFresh } from './hydrate.js';
import { listAreas as listAreaDirs } from './area.js';
import { generateId } from './id.js';
import { EntryNotFoundError } from './errors.js';
import type {
  KnowledgeStore,
  KnowledgeEntry,
  EntryFilter,
  EntryType,
  AddFactOptions,
  AddDecisionOptions,
  AddGotchaOptions,
  AddPatternOptions,
  AddLinkOptions,
} from './types.js';
import { Zone, ProvenanceStatus } from './types.js';

type FtsAreaRow = {
  area: string;
  rank: number;
};

function nowIso(): string {
  return new Date().toISOString();
}

export class MykbStore implements KnowledgeStore {
  private db: Database.Database;
  private brainPath: string;

  private constructor(brainPath: string, db: Database.Database) {
    this.brainPath = brainPath;
    this.db = db;
  }

  static open(brainPath: string): MykbStore {
    const dbPath = path.join(brainPath, 'kb.db');
    const db = createDatabase(dbPath);
    ensureFresh(db, brainPath);
    return new MykbStore(brainPath, db);
  }

  close(): void {
    this.db.close();
  }

  addFact(area: string, text: string, options?: AddFactOptions): string {
    return this.addEntry(area, 'fact', text, options);
  }

  addDecision(area: string, text: string, options?: AddDecisionOptions): string {
    const entry = this.buildEntry(area, 'decision', text, options);
    if (options?.why) (entry as Record<string, unknown>).why = options.why;
    if (options?.rejected) (entry as Record<string, unknown>).rejected = options.rejected;
    if (options?.context) (entry as Record<string, unknown>).context = options.context;
    return this.persistEntry(entry);
  }

  addGotcha(area: string, text: string, options?: AddGotchaOptions): string {
    const entry = this.buildEntry(area, 'gotcha', text, options);
    (entry as Record<string, unknown>).failed = options?.failed ?? false;
    (entry as Record<string, unknown>).resolution = options?.resolution ?? null;
    return this.persistEntry(entry);
  }

  addPattern(area: string, text: string, options?: AddPatternOptions): string {
    return this.addEntry(area, 'pattern', text, options);
  }

  addLink(area: string, text: string, url: string, options?: AddLinkOptions): string {
    const entry = this.buildEntry(area, 'link', text, options);
    (entry as Record<string, unknown>).url = url;
    return this.persistEntry(entry);
  }

  updateEntry(area: string, id: string, updates: Partial<KnowledgeEntry>): void {
    const existing = this.findEntry(area, id);
    const updated: KnowledgeEntry = {
      ...existing,
      ...updates,
      id: existing.id,
      area: existing.area,
      type: existing.type,
      created: existing.created,
      updated: nowIso(),
    };
    appendEntry(this.brainPath, area, updated);
    dbUpsert(this.db, updated);
  }

  deleteEntry(area: string, id: string): void {
    const existing = this.findEntry(area, id);
    writeTombstone(this.brainPath, area, id, existing.type);
    dbDelete(this.db, id);
  }

  verifyEntry(area: string, id: string): void {
    this.updateEntry(area, id, {
      provenance: {
        status: ProvenanceStatus.Verified,
        date: nowIso(),
      },
    });
  }

  promoteEntry(area: string, id: string): void {
    this.updateEntry(area, id, { zone: Zone.Established });
  }

  archiveEntry(area: string, id: string): void {
    this.updateEntry(area, id, { zone: Zone.Archive });
  }

  loadArea(area: string, filter?: EntryFilter): KnowledgeEntry[] {
    return queryEntries(this.db, { area, ...filter });
  }

  search(query: string): KnowledgeEntry[] {
    return searchEntries(this.db, query);
  }

  matchAreas(text: string): { area: string; score: number }[] {
    const ftsRows = this.db
      .prepare(`SELECT area, rank FROM entries_fts WHERE entries_fts MATCH @query ORDER BY rank`)
      .all({ query: text }) as FtsAreaRow[];

    // Group by area, take best (most negative) rank per area
    const areaScores = new Map<string, number>();
    for (const row of ftsRows) {
      const existing = areaScores.get(row.area);
      if (existing === undefined || row.rank < existing) {
        areaScores.set(row.area, row.rank);
      }
    }

    return Array.from(areaScores.entries())
      .map(([area, rank]) => ({ area, score: -rank }))
      .sort((a, b) => b.score - a.score);
  }

  compact(area?: string): void {
    if (area) {
      compactEntries(this.brainPath, area);
    } else {
      const areas = listAreaDirs(this.brainPath);
      for (const a of areas) {
        compactEntries(this.brainPath, a.id);
      }
    }
  }

  private addEntry(
    area: string,
    type: EntryType,
    text: string,
    options?: AddFactOptions | AddPatternOptions,
  ): string {
    const entry = this.buildEntry(area, type, text, options);
    return this.persistEntry(entry);
  }

  private buildEntry(
    area: string,
    type: EntryType,
    text: string,
    options?: AddFactOptions,
  ): KnowledgeEntry {
    const now = nowIso();
    return {
      id: generateId(),
      area,
      type,
      text,
      tags: options?.tags ?? [],
      provenance: options?.provenance ?? { status: ProvenanceStatus.Unverified },
      zone: options?.zone ?? Zone.Active,
      created: now,
      updated: now,
    };
  }

  private persistEntry(entry: KnowledgeEntry): string {
    appendEntry(this.brainPath, entry.area, entry);
    dbUpsert(this.db, entry);
    return entry.id;
  }

  private findEntry(area: string, id: string): KnowledgeEntry {
    const results = queryEntries(this.db, { area });
    const entry = results.find((e) => e.id === id);
    if (!entry) {
      throw new EntryNotFoundError(`Entry '${id}' not found in area '${area}'`);
    }
    return entry;
  }
}
