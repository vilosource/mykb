import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import path from 'node:path';
import { withTempBrain } from '../helpers.js';
import {
  createDatabase,
  upsertEntry,
  queryEntries,
  deleteEntry,
  searchEntries,
  sanitizeFtsQuery,
  upsertArea,
  listAreas,
  getAreaStats,
  getLastHydrated,
  setLastHydrated,
} from '../../src/core/db.js';
import {
  type KnowledgeEntry,
  type AreaMetadata,
  type EntryFilter,
  ProvenanceStatus,
  Zone,
} from '../../src/core/types.js';

function makeEntry(overrides: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  return {
    id: 'testid01',
    area: 'networking',
    type: 'fact',
    text: 'DNS uses CoreDNS',
    tags: ['dns'],
    provenance: { status: ProvenanceStatus.Verified, date: '2026-03-15' },
    zone: Zone.Active,
    created: '2026-03-15T10:00:00Z',
    updated: '2026-03-15T10:00:00Z',
    ...overrides,
  };
}

function makeArea(overrides: Partial<AreaMetadata> = {}): AreaMetadata {
  return {
    id: 'networking',
    name: 'Networking',
    summary: 'Network infrastructure knowledge',
    owner: 'jason',
    tags: ['net', 'dns'],
    created: '2026-03-15',
    updated: '2026-03-15',
    ...overrides,
  };
}

// --- 1. Database creation ---

describe('createDatabase', () => {
  it('should create SQLite database with entries, entries_fts, areas, and meta tables', async () => {
    await withTempBrain(async (brainPath) => {
      const dbPath = path.join(brainPath, 'kb.db');
      const db = createDatabase(dbPath);

      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as { name: string }[];
      const tableNames = tables.map((t) => t.name);

      expect(tableNames).toContain('entries');
      expect(tableNames).toContain('entries_fts');
      expect(tableNames).toContain('areas');
      expect(tableNames).toContain('meta');

      db.close();
    });
  });

  it('should enable WAL journal mode', async () => {
    await withTempBrain(async (brainPath) => {
      const dbPath = path.join(brainPath, 'kb.db');
      const db = createDatabase(dbPath);

      const result = db.pragma('journal_mode') as { journal_mode: string }[];
      expect(result[0].journal_mode).toBe('wal');

      db.close();
    });
  });

  it('should create correct columns on entries table', async () => {
    await withTempBrain(async (brainPath) => {
      const dbPath = path.join(brainPath, 'kb.db');
      const db = createDatabase(dbPath);

      const columns = db.prepare('PRAGMA table_info(entries)').all() as { name: string }[];
      const colNames = columns.map((c) => c.name);

      const expectedColumns = [
        'id',
        'area',
        'type',
        'text',
        'tags',
        'zone',
        'prov_status',
        'prov_date',
        'prov_source',
        'prov_detail',
        'why',
        'rejected',
        'context',
        'failed',
        'resolution',
        'url',
        'created',
        'updated',
      ];

      for (const col of expectedColumns) {
        expect(colNames, `missing column: ${col}`).toContain(col);
      }

      db.close();
    });
  });

  it('should create correct indexes on entries table', async () => {
    await withTempBrain(async (brainPath) => {
      const dbPath = path.join(brainPath, 'kb.db');
      const db = createDatabase(dbPath);

      const indexes = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='entries'")
        .all() as { name: string }[];
      const indexNames = indexes.map((i) => i.name);

      expect(indexNames).toContain('idx_area');
      expect(indexNames).toContain('idx_type');
      expect(indexNames).toContain('idx_zone');
      expect(indexNames).toContain('idx_prov_status');
      expect(indexNames).toContain('idx_prov_date');

      db.close();
    });
  });

  it('should work with in-memory database', () => {
    const db = createDatabase(':memory:');

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const tableNames = tables.map((t) => t.name);

    expect(tableNames).toContain('entries');
    expect(tableNames).toContain('entries_fts');
    expect(tableNames).toContain('areas');

    db.close();
  });
});

// --- 2. Entry CRUD ---

describe('entry CRUD', () => {
  const cases = [
    {
      name: 'should upsert and query an entry',
      setup: (db: Database.Database) => {
        upsertEntry(db, makeEntry());
      },
      filter: { area: 'networking' } as EntryFilter,
      expected: (entries: KnowledgeEntry[]) => {
        expect(entries).toHaveLength(1);
        expect(entries[0].id).toBe('testid01');
        expect(entries[0].text).toBe('DNS uses CoreDNS');
        expect(entries[0].tags).toEqual(['dns']);
        expect(entries[0].provenance.status).toBe(ProvenanceStatus.Verified);
      },
    },
    {
      name: 'should return latest entry when same ID upserted twice',
      setup: (db: Database.Database) => {
        upsertEntry(db, makeEntry({ text: 'old text' }));
        upsertEntry(db, makeEntry({ text: 'new text', updated: '2026-03-15T11:00:00Z' }));
      },
      filter: { area: 'networking' } as EntryFilter,
      expected: (entries: KnowledgeEntry[]) => {
        expect(entries).toHaveLength(1);
        expect(entries[0].text).toBe('new text');
      },
    },
    {
      name: 'should return nothing after delete',
      setup: (db: Database.Database) => {
        upsertEntry(db, makeEntry());
        deleteEntry(db, 'testid01');
      },
      filter: { area: 'networking' } as EntryFilter,
      expected: (entries: KnowledgeEntry[]) => {
        expect(entries).toHaveLength(0);
      },
    },
  ];

  for (const { name, setup, filter, expected } of cases) {
    it(name, () => {
      const db = createDatabase(':memory:');
      setup(db);
      const entries = queryEntries(db, filter);
      expected(entries);
      db.close();
    });
  }

  it('should preserve decision-specific fields', () => {
    const db = createDatabase(':memory:');
    upsertEntry(db, {
      ...makeEntry({ id: 'dec00001', type: 'decision' }),
      why: 'Because it is better',
      rejected: 'The old way',
      context: 'During architecture review',
    } as KnowledgeEntry);

    const entries = queryEntries(db, { area: 'networking' });
    expect(entries).toHaveLength(1);
    const entry = entries[0] as Record<string, unknown>;
    expect(entry.why).toBe('Because it is better');
    expect(entry.rejected).toBe('The old way');
    expect(entry.context).toBe('During architecture review');

    db.close();
  });

  it('should preserve gotcha-specific fields', () => {
    const db = createDatabase(':memory:');
    upsertEntry(db, {
      ...makeEntry({ id: 'got00001', type: 'gotcha' }),
      failed: true,
      resolution: 'resolved',
    } as KnowledgeEntry);

    const entries = queryEntries(db, { area: 'networking' });
    expect(entries).toHaveLength(1);
    const entry = entries[0] as Record<string, unknown>;
    expect(entry.failed).toBe(true);
    expect(entry.resolution).toBe('resolved');

    db.close();
  });

  it('should preserve link-specific fields', () => {
    const db = createDatabase(':memory:');
    upsertEntry(db, {
      ...makeEntry({ id: 'lnk00001', type: 'link' }),
      url: 'https://example.com',
    } as KnowledgeEntry);

    const entries = queryEntries(db, { area: 'networking' });
    expect(entries).toHaveLength(1);
    const entry = entries[0] as Record<string, unknown>;
    expect(entry.url).toBe('https://example.com');

    db.close();
  });
});

// --- 3. FTS5 search ---

describe('searchEntries', () => {
  it('should return matching entries ranked by BM25', () => {
    const db = createDatabase(':memory:');

    upsertEntry(
      db,
      makeEntry({ id: 'dns00001', text: 'DNS uses CoreDNS with zone forwarding', tags: ['dns'] }),
    );
    upsertEntry(
      db,
      makeEntry({
        id: 'nat00001',
        text: 'NAT gateway handles routing',
        tags: ['nat'],
        area: 'networking',
      }),
    );
    upsertEntry(
      db,
      makeEntry({
        id: 'dns00002',
        text: 'DNS resolution is cached for 300 seconds',
        tags: ['dns', 'cache'],
        area: 'networking',
      }),
    );

    const results = searchEntries(db, 'DNS');
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(
      results.every((r) => r.text.toLowerCase().includes('dns') || r.tags.includes('dns')),
    ).toBe(true);

    db.close();
  });

  it('should exclude archived entries when excludeZone is set', () => {
    const db = createDatabase(':memory:');

    upsertEntry(
      db,
      makeEntry({ id: 'dns-active', text: 'DNS uses CoreDNS', zone: Zone.Active }),
    );
    upsertEntry(
      db,
      makeEntry({ id: 'dns-archived', text: 'DNS used BIND9 (deprecated)', zone: Zone.Archive }),
    );

    const results = searchEntries(db, 'DNS', Zone.Archive);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('dns-active');

    db.close();
  });

  it('should return all entries including archived when no excludeZone', () => {
    const db = createDatabase(':memory:');

    upsertEntry(
      db,
      makeEntry({ id: 'dns-active', text: 'DNS uses CoreDNS', zone: Zone.Active }),
    );
    upsertEntry(
      db,
      makeEntry({ id: 'dns-archived', text: 'DNS used BIND9 (deprecated)', zone: Zone.Archive }),
    );

    const results = searchEntries(db, 'DNS');
    expect(results).toHaveLength(2);

    db.close();
  });

  it('should return empty array for non-matching query', () => {
    const db = createDatabase(':memory:');

    upsertEntry(db, makeEntry());

    const results = searchEntries(db, 'kubernetes');
    expect(results).toHaveLength(0);

    db.close();
  });

  it('should search across text and tags', () => {
    const db = createDatabase(':memory:');

    upsertEntry(
      db,
      makeEntry({ id: 'tag00001', text: 'Some unrelated text', tags: ['kubernetes'] }),
    );

    const results = searchEntries(db, 'kubernetes');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('tag00001');

    db.close();
  });

  // --- Area-metadata search path ---
  // FTS5 indexes (entries_fts) cover entry text + entry tags only. An
  // area's summary and area-level tags should also be searchable so a
  // query like "frobnicator" finds entries from the frobnicators area
  // even when none of those entries' text/tags spell "frobnicator".
  // Driven by experiments/kb-search/scenarios/tool-finds-via-area-metadata.sh.

  it('returns entries when query matches area summary', () => {
    const db = createDatabase(':memory:');

    // Area whose summary contains the keyword. Entry text/tags do NOT.
    upsertArea(
      db,
      makeArea({
        id: 'frobnicators',
        name: 'Frobnicators',
        summary: 'Frobnicator calibration tolerances and drift coefficients',
        tags: [],
      }),
    );
    upsertEntry(
      db,
      makeEntry({
        id: 'frob0001',
        area: 'frobnicators',
        text: 'blue units are rated for 12.7 hertz',
        tags: ['spec', 'hertz'],
      }),
    );

    const results = searchEntries(db, 'frobnicator');
    expect(results.map((r) => r.id)).toContain('frob0001');

    db.close();
  });

  it('returns entries when query matches area-level tags', () => {
    const db = createDatabase(':memory:');

    upsertArea(
      db,
      makeArea({
        id: 'frobnicators',
        name: 'Frobnicators',
        summary: 'Hardware specifications',
        tags: ['frobnicator', 'calibration'],
      }),
    );
    upsertEntry(
      db,
      makeEntry({
        id: 'frob0002',
        area: 'frobnicators',
        text: 'blue units are rated for 12.7 hertz',
        tags: ['spec'],
      }),
    );

    const results = searchEntries(db, 'frobnicator');
    expect(results.map((r) => r.id)).toContain('frob0002');

    db.close();
  });

  it('does not return entries from areas whose metadata does not match', () => {
    const db = createDatabase(':memory:');

    upsertArea(
      db,
      makeArea({
        id: 'unrelated',
        name: 'Unrelated',
        summary: 'Topics about cooking',
        tags: ['recipe'],
      }),
    );
    upsertEntry(
      db,
      makeEntry({
        id: 'cook0001',
        area: 'unrelated',
        text: 'simmer for 20 minutes',
        tags: ['kitchen'],
      }),
    );

    const results = searchEntries(db, 'frobnicator');
    expect(results).toHaveLength(0);

    db.close();
  });

  it('updates area-metadata index on upsertArea so renamed summaries are searchable', () => {
    const db = createDatabase(':memory:');

    upsertArea(
      db,
      makeArea({ id: 'frobnicators', summary: 'old summary about widgets', tags: [] }),
    );
    upsertEntry(
      db,
      makeEntry({ id: 'frob0003', area: 'frobnicators', text: 'plain entry', tags: [] }),
    );

    // Rename: replace the summary with one that mentions the keyword.
    upsertArea(
      db,
      makeArea({
        id: 'frobnicators',
        summary: 'frobnicator calibration tolerances',
        tags: [],
        updated: '2026-04-01',
      }),
    );

    const results = searchEntries(db, 'frobnicator');
    expect(results.map((r) => r.id)).toContain('frob0003');

    // Old summary's keyword should no longer surface the entry.
    const stale = searchEntries(db, 'widgets');
    expect(stale).toHaveLength(0);

    db.close();
  });
});

// --- 3b. sanitizeFtsQuery ---

describe('sanitizeFtsQuery', () => {
  const cases = [
    { input: 'fi-abakus', expected: '"fi-abakus"', name: 'hyphenated term' },
    { input: 'DNS', expected: '"DNS"', name: 'simple term' },
    { input: 'postnord server', expected: '"postnord" "server"', name: 'multi-word AND' },
    { input: 'fi-sr-012', expected: '"fi-sr-012"', name: 'multiple hyphens' },
    { input: '', expected: '', name: 'empty string' },
    { input: '  spaced  ', expected: '"spaced"', name: 'extra whitespace' },
    { input: 'PLANDENT-004', expected: '"PLANDENT-004"', name: 'decision ID pattern' },
  ];

  for (const { input, expected, name } of cases) {
    it(`should handle ${name}: "${input}" → ${expected || '""'}`, () => {
      expect(sanitizeFtsQuery(input)).toBe(expected);
    });
  }
});

// --- 3c. searchEntries with hyphenated text ---

describe('searchEntries with hyphenated text', () => {
  it('should return results when entry text contains hyphens', () => {
    const db = createDatabase(':memory:');

    upsertEntry(
      db,
      makeEntry({
        id: 'hyp00001',
        text: 'fi-abakus server runs PostNord integration',
        area: 'postnord',
      }),
    );
    upsertEntry(
      db,
      makeEntry({
        id: 'hyp00002',
        text: 'PLANDENT-004 decision about database migration',
        area: 'plandent',
      }),
    );

    const results1 = searchEntries(db, 'fi-abakus');
    expect(results1).toHaveLength(1);
    expect(results1[0].id).toBe('hyp00001');

    const results2 = searchEntries(db, 'PLANDENT-004');
    expect(results2).toHaveLength(1);
    expect(results2[0].id).toBe('hyp00002');

    db.close();
  });
});

// --- 4. Query filters ---

describe('queryEntries with filters', () => {
  function seedEntries(db: Database.Database): void {
    upsertEntry(
      db,
      makeEntry({
        id: 'net-f-01',
        area: 'networking',
        type: 'fact',
        zone: Zone.Active,
        tags: ['dns'],
      }),
    );
    upsertEntry(
      db,
      makeEntry({
        id: 'net-d-01',
        area: 'networking',
        type: 'decision',
        zone: Zone.Established,
        tags: ['architecture'],
      }),
    );
    upsertEntry(
      db,
      makeEntry({
        id: 'ci-f-01',
        area: 'ci-pipelines',
        type: 'fact',
        zone: Zone.Active,
        tags: ['runners'],
        text: 'Runners use spot instances',
      }),
    );
    upsertEntry(
      db,
      makeEntry({
        id: 'net-g-01',
        area: 'networking',
        type: 'gotcha',
        zone: Zone.Active,
        tags: ['dns', 'cache'],
        provenance: { status: ProvenanceStatus.Stale },
      }),
    );
  }

  function seedEntriesWithArchive(db: Database.Database): void {
    seedEntries(db);
    upsertEntry(
      db,
      makeEntry({
        id: 'net-a-01',
        area: 'networking',
        type: 'fact',
        zone: Zone.Archive,
        tags: ['old'],
        text: 'Archived DNS fact',
      }),
    );
  }

  const filterCases = [
    {
      name: 'should filter by area only',
      filter: { area: 'networking' } as EntryFilter,
      expectedIds: ['net-d-01', 'net-f-01', 'net-g-01'],
    },
    {
      name: 'should filter by type only',
      filter: { type: 'fact' as const } as EntryFilter,
      expectedIds: ['ci-f-01', 'net-f-01'],
    },
    {
      name: 'should filter by zone only',
      filter: { zone: Zone.Established } as EntryFilter,
      expectedIds: ['net-d-01'],
    },
    {
      name: 'should filter by tags (LIKE match)',
      filter: { tags: ['dns'] } as EntryFilter,
      expectedIds: ['net-f-01', 'net-g-01'],
    },
    {
      name: 'should filter by provenance status',
      filter: { provStatus: ProvenanceStatus.Stale } as EntryFilter,
      expectedIds: ['net-g-01'],
    },
    {
      name: 'should combine area and type filters',
      filter: { area: 'networking', type: 'fact' as const } as EntryFilter,
      expectedIds: ['net-f-01'],
    },
    {
      name: 'should return all entries with empty filter',
      filter: {} as EntryFilter,
      expectedIds: ['ci-f-01', 'net-d-01', 'net-f-01', 'net-g-01'],
    },
  ];

  for (const { name, filter, expectedIds } of filterCases) {
    it(name, () => {
      const db = createDatabase(':memory:');
      seedEntries(db);
      const entries = queryEntries(db, filter);
      const ids = entries.map((e) => e.id).sort();
      expect(ids).toEqual(expectedIds.sort());
      db.close();
    });
  }

  it('should exclude archived entries with excludeZone filter', () => {
    const db = createDatabase(':memory:');
    seedEntriesWithArchive(db);
    const entries = queryEntries(db, { area: 'networking', excludeZone: Zone.Archive });
    const ids = entries.map((e) => e.id).sort();
    expect(ids).toEqual(['net-d-01', 'net-f-01', 'net-g-01']);
    db.close();
  });

  it('should return archived entries when no excludeZone is set', () => {
    const db = createDatabase(':memory:');
    seedEntriesWithArchive(db);
    const entries = queryEntries(db, { area: 'networking' });
    const ids = entries.map((e) => e.id).sort();
    expect(ids).toEqual(['net-a-01', 'net-d-01', 'net-f-01', 'net-g-01']);
    db.close();
  });
});

// --- 5. Area metadata ---

describe('area metadata', () => {
  it('should upsert and list areas', () => {
    const db = createDatabase(':memory:');
    const area = makeArea();

    upsertArea(db, area);

    const areas = listAreas(db);
    expect(areas).toHaveLength(1);
    expect(areas[0].id).toBe('networking');
    expect(areas[0].name).toBe('Networking');
    expect(areas[0].summary).toBe('Network infrastructure knowledge');
    expect(areas[0].tags).toEqual(['net', 'dns']);

    db.close();
  });

  it('should upsert same area ID and keep latest', () => {
    const db = createDatabase(':memory:');

    upsertArea(db, makeArea({ summary: 'old summary' }));
    upsertArea(db, makeArea({ summary: 'new summary', updated: '2026-03-16' }));

    const areas = listAreas(db);
    expect(areas).toHaveLength(1);
    expect(areas[0].summary).toBe('new summary');

    db.close();
  });
});

// --- Area stats ---

describe('getAreaStats', () => {
  it('should return counts by type for an area', () => {
    const db = createDatabase(':memory:');

    upsertEntry(db, makeEntry({ id: 'f1', area: 'networking', type: 'fact' }));
    upsertEntry(db, makeEntry({ id: 'f2', area: 'networking', type: 'fact' }));
    upsertEntry(db, makeEntry({ id: 'd1', area: 'networking', type: 'decision' }));
    upsertEntry(db, makeEntry({ id: 'g1', area: 'networking', type: 'gotcha' }));
    upsertEntry(db, makeEntry({ id: 'p1', area: 'networking', type: 'pattern' }));
    upsertEntry(db, makeEntry({ id: 'l1', area: 'networking', type: 'link' }));

    const stats = getAreaStats(db, 'networking');
    expect(stats).toEqual({
      facts: 2,
      decisions: 1,
      gotchas: 1,
      patterns: 1,
      links: 1,
    });

    db.close();
  });

  it('should return zero counts for area with no entries', () => {
    const db = createDatabase(':memory:');

    const stats = getAreaStats(db, 'empty-area');
    expect(stats).toEqual({
      facts: 0,
      decisions: 0,
      gotchas: 0,
      patterns: 0,
      links: 0,
    });

    db.close();
  });
});

// --- 6. Staleness tracking ---

describe('staleness tracking', () => {
  it('should return null when last_hydrated not set', () => {
    const db = createDatabase(':memory:');
    expect(getLastHydrated(db)).toBeNull();
    db.close();
  });

  it('should store and retrieve last_hydrated timestamp', () => {
    const db = createDatabase(':memory:');
    const timestamp = '2026-03-15T10:00:00Z';

    setLastHydrated(db, timestamp);
    expect(getLastHydrated(db)).toBe(timestamp);

    db.close();
  });

  it('should overwrite previous last_hydrated value', () => {
    const db = createDatabase(':memory:');

    setLastHydrated(db, '2026-03-15T10:00:00Z');
    setLastHydrated(db, '2026-03-15T12:00:00Z');

    expect(getLastHydrated(db)).toBe('2026-03-15T12:00:00Z');

    db.close();
  });
});
