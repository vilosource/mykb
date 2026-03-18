import Database from 'better-sqlite3';
import { DatabaseError } from './errors.js';
import { type KnowledgeEntry, type AreaMetadata, type EntryFilter, type Zone } from './types.js';

export type AreaStats = {
  facts: number;
  decisions: number;
  gotchas: number;
  patterns: number;
  links: number;
};

type EntryRow = {
  id: string;
  area: string;
  type: string;
  text: string;
  tags: string | null;
  zone: string;
  prov_status: string | null;
  prov_date: string | null;
  prov_source: string | null;
  prov_detail: string | null;
  why: string | null;
  rejected: string | null;
  context: string | null;
  failed: number;
  resolution: string | null;
  url: string | null;
  created: string;
  updated: string;
};

type AreaRow = {
  id: string;
  name: string;
  summary: string | null;
  owner: string | null;
  tags: string | null;
  created: string;
  updated: string;
};

type MetaRow = {
  key: string;
  value: string;
};

type CountRow = {
  type: string;
  count: number;
};

type FtsMatchRow = {
  id: string;
  rank: number;
};

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS entries (
  id          TEXT PRIMARY KEY,
  area        TEXT NOT NULL,
  type        TEXT NOT NULL CHECK(type IN ('fact','decision','gotcha','pattern','link')),
  text        TEXT NOT NULL,
  tags        TEXT,
  zone        TEXT NOT NULL DEFAULT 'active' CHECK(zone IN ('active','established','archive')),
  prov_status TEXT CHECK(prov_status IN ('verified','unverified','stale','expires')),
  prov_date   TEXT,
  prov_source TEXT,
  prov_detail TEXT,
  why         TEXT,
  rejected    TEXT,
  context     TEXT,
  failed      INTEGER DEFAULT 0,
  resolution  TEXT CHECK(resolution IN (NULL,'resolved','mitigated','wontfix')),
  url         TEXT,
  created     TEXT NOT NULL,
  updated     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_area ON entries(area);
CREATE INDEX IF NOT EXISTS idx_type ON entries(area, type);
CREATE INDEX IF NOT EXISTS idx_zone ON entries(area, zone);
CREATE INDEX IF NOT EXISTS idx_prov_status ON entries(prov_status);
CREATE INDEX IF NOT EXISTS idx_prov_date ON entries(prov_date);

CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(id, text, tags, area);

CREATE TABLE IF NOT EXISTS areas (
  id      TEXT PRIMARY KEY,
  name    TEXT NOT NULL,
  summary TEXT,
  owner   TEXT,
  tags    TEXT,
  created TEXT NOT NULL,
  updated TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
`;

function rowToEntry(row: EntryRow): KnowledgeEntry {
  const entry: Record<string, unknown> = {
    id: row.id,
    area: row.area,
    type: row.type,
    text: row.text,
    tags: row.tags ? (JSON.parse(row.tags) as string[]) : [],
    provenance: {
      status: row.prov_status ?? 'unverified',
      ...(row.prov_date ? { date: row.prov_date } : {}),
      ...(row.prov_source ? { source: row.prov_source } : {}),
      ...(row.prov_detail ? { detail: row.prov_detail } : {}),
    },
    zone: row.zone,
    created: row.created,
    updated: row.updated,
  };

  if (row.type === 'decision') {
    if (row.why !== null) entry.why = row.why;
    if (row.rejected !== null) entry.rejected = row.rejected;
    if (row.context !== null) entry.context = row.context;
  }

  if (row.type === 'gotcha') {
    entry.failed = row.failed === 1;
    entry.resolution = row.resolution;
  }

  if (row.type === 'link') {
    if (row.url !== null) entry.url = row.url;
  }

  return entry as KnowledgeEntry;
}

function rowToArea(row: AreaRow): AreaMetadata {
  return {
    id: row.id,
    name: row.name,
    summary: row.summary ?? '',
    owner: row.owner ?? '',
    tags: row.tags ? (JSON.parse(row.tags) as string[]) : [],
    created: row.created,
    updated: row.updated,
  };
}

export function createDatabase(dbPath: string): Database.Database {
  try {
    const db = new Database(dbPath);
    if (dbPath !== ':memory:') {
      db.pragma('journal_mode = WAL');
    }
    db.exec(SCHEMA_SQL);
    return db;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new DatabaseError(`Failed to create database: ${message}`);
  }
}

export function upsertEntry(db: Database.Database, entry: KnowledgeEntry): void {
  const entryRecord = entry as Record<string, unknown>;
  const tagsJson = JSON.stringify(entry.tags);

  const upsertSql = db.prepare(`
    INSERT OR REPLACE INTO entries (
      id, area, type, text, tags, zone,
      prov_status, prov_date, prov_source, prov_detail,
      why, rejected, context, failed, resolution, url,
      created, updated
    ) VALUES (
      @id, @area, @type, @text, @tags, @zone,
      @prov_status, @prov_date, @prov_source, @prov_detail,
      @why, @rejected, @context, @failed, @resolution, @url,
      @created, @updated
    )
  `);

  const deleteFts = db.prepare('DELETE FROM entries_fts WHERE id = @id');
  const insertFts = db.prepare(
    'INSERT INTO entries_fts (id, text, tags, area) VALUES (@id, @text, @tags, @area)',
  );

  const params = {
    id: entry.id,
    area: entry.area,
    type: entry.type,
    text: entry.text,
    tags: tagsJson,
    zone: entry.zone,
    prov_status: entry.provenance?.status ?? null,
    prov_date: entry.provenance?.date ?? null,
    prov_source: entry.provenance?.source ?? null,
    prov_detail: entry.provenance?.detail ?? null,
    why: (entryRecord.why as string) ?? null,
    rejected: (entryRecord.rejected as string) ?? null,
    context: (entryRecord.context as string) ?? null,
    failed: (entryRecord.failed as boolean) ? 1 : 0,
    resolution: (entryRecord.resolution as string) ?? null,
    url: (entryRecord.url as string) ?? null,
    created: entry.created,
    updated: entry.updated,
  };

  const transaction = db.transaction(() => {
    upsertSql.run(params);
    deleteFts.run({ id: entry.id });
    insertFts.run({
      id: entry.id,
      text: entry.text,
      tags: tagsJson,
      area: entry.area,
    });
  });

  transaction();
}

export function deleteEntry(db: Database.Database, id: string): void {
  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM entries WHERE id = ?').run(id);
    db.prepare('DELETE FROM entries_fts WHERE id = ?').run(id);
  });

  transaction();
}

export function queryEntries(db: Database.Database, filter: EntryFilter): KnowledgeEntry[] {
  const conditions: string[] = [];
  const params: Record<string, string> = {};

  if (filter.area) {
    conditions.push('area = @area');
    params.area = filter.area;
  }

  if (filter.type) {
    conditions.push('type = @type');
    params.type = filter.type;
  }

  if (filter.zone) {
    conditions.push('zone = @zone');
    params.zone = filter.zone;
  }

  if (filter.excludeZone) {
    conditions.push('zone != @excludeZone');
    params.excludeZone = filter.excludeZone;
  }

  if (filter.provStatus) {
    conditions.push('prov_status = @provStatus');
    params.provStatus = filter.provStatus;
  }

  if (filter.tags && filter.tags.length > 0) {
    const tagConditions = filter.tags.map((tag, i) => {
      const paramName = `tag${i}`;
      params[paramName] = `%"${tag}"%`;
      return `tags LIKE @${paramName}`;
    });
    conditions.push(`(${tagConditions.join(' AND ')})`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const sql = `SELECT * FROM entries ${whereClause} ORDER BY id`;

  const rows = db.prepare(sql).all(params) as EntryRow[];
  return rows.map(rowToEntry);
}

export function sanitizeFtsQuery(query: string): string {
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return '';
  return tokens.map((t) => `"${t}"`).join(' ');
}

export function searchEntries(db: Database.Database, query: string, excludeZone?: Zone): KnowledgeEntry[] {
  const sanitized = sanitizeFtsQuery(query);
  if (!sanitized) return [];
  const ftsRows = db
    .prepare(`SELECT id, rank FROM entries_fts WHERE entries_fts MATCH @query ORDER BY rank`)
    .all({ query: sanitized }) as FtsMatchRow[];

  if (ftsRows.length === 0) return [];

  const ids = ftsRows.map((r) => r.id);
  const placeholders = ids.map(() => '?').join(',');
  let entrySql = `SELECT * FROM entries WHERE id IN (${placeholders})`;
  const entryParams: unknown[] = [...ids];
  if (excludeZone) {
    entrySql += ' AND zone != ?';
    entryParams.push(excludeZone);
  }
  const entryRows = db
    .prepare(entrySql)
    .all(...entryParams) as EntryRow[];

  // Preserve FTS5 rank ordering
  const entryMap = new Map<string, EntryRow>();
  for (const row of entryRows) {
    entryMap.set(row.id, row);
  }

  const results: KnowledgeEntry[] = [];
  for (const ftsRow of ftsRows) {
    const row = entryMap.get(ftsRow.id);
    if (row) results.push(rowToEntry(row));
  }

  return results;
}

export function upsertArea(db: Database.Database, area: AreaMetadata): void {
  db.prepare(
    `
    INSERT OR REPLACE INTO areas (id, name, summary, owner, tags, created, updated)
    VALUES (@id, @name, @summary, @owner, @tags, @created, @updated)
  `,
  ).run({
    id: area.id,
    name: area.name,
    summary: area.summary ?? null,
    owner: area.owner ?? null,
    tags: JSON.stringify(area.tags),
    created: area.created,
    updated: area.updated,
  });
}

export function listAreas(db: Database.Database): AreaMetadata[] {
  const rows = db.prepare('SELECT * FROM areas ORDER BY id').all() as AreaRow[];
  return rows.map(rowToArea);
}

export function getAreaStats(db: Database.Database, area: string): AreaStats {
  const rows = db
    .prepare('SELECT type, COUNT(*) as count FROM entries WHERE area = ? GROUP BY type')
    .all(area) as CountRow[];

  const stats: AreaStats = {
    facts: 0,
    decisions: 0,
    gotchas: 0,
    patterns: 0,
    links: 0,
  };

  for (const row of rows) {
    switch (row.type) {
      case 'fact':
        stats.facts = row.count;
        break;
      case 'decision':
        stats.decisions = row.count;
        break;
      case 'gotcha':
        stats.gotchas = row.count;
        break;
      case 'pattern':
        stats.patterns = row.count;
        break;
      case 'link':
        stats.links = row.count;
        break;
    }
  }

  return stats;
}

export function getLastHydrated(db: Database.Database): string | null {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'last_hydrated'").get() as
    | MetaRow
    | undefined;
  return row?.value ?? null;
}

export function setLastHydrated(db: Database.Database, timestamp: string): void {
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('last_hydrated', @timestamp)").run({
    timestamp,
  });
}
