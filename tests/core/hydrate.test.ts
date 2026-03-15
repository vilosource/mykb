import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { withTempBrain } from '../helpers.js';
import { createDatabase, queryEntries, listAreas, getLastHydrated } from '../../src/core/db.js';
import { hydrateDatabase, isStale, ensureFresh } from '../../src/core/hydrate.js';
import { ProvenanceStatus, Zone } from '../../src/core/types.js';
import type { KnowledgeEntry, TombstoneEntry, AreaMetadata } from '../../src/core/types.js';

function writeJsonlEntry(brainPath: string, area: string, type: string, entry: KnowledgeEntry): void {
  const typeToFile: Record<string, string> = {
    fact: 'facts.jsonl',
    decision: 'decisions.jsonl',
    gotcha: 'gotchas.jsonl',
    pattern: 'patterns.jsonl',
    link: 'links.jsonl',
  };
  const areaDir = path.join(brainPath, 'areas', area);
  fs.mkdirSync(areaDir, { recursive: true });
  const filePath = path.join(areaDir, typeToFile[type]);
  fs.appendFileSync(filePath, JSON.stringify(entry) + '\n');
}

function writeTombstone(brainPath: string, area: string, type: string, id: string): void {
  const typeToFile: Record<string, string> = {
    fact: 'facts.jsonl',
    decision: 'decisions.jsonl',
    gotcha: 'gotchas.jsonl',
    pattern: 'patterns.jsonl',
    link: 'links.jsonl',
  };
  const areaDir = path.join(brainPath, 'areas', area);
  fs.mkdirSync(areaDir, { recursive: true });
  const filePath = path.join(areaDir, typeToFile[type]);
  const tombstone: TombstoneEntry = {
    id,
    area,
    deleted: true,
    updated: new Date().toISOString(),
  };
  fs.appendFileSync(filePath, JSON.stringify(tombstone) + '\n');
}

function writeAreaJson(brainPath: string, metadata: AreaMetadata): void {
  const areaDir = path.join(brainPath, 'areas', metadata.id);
  fs.mkdirSync(areaDir, { recursive: true });
  fs.writeFileSync(path.join(areaDir, 'area.json'), JSON.stringify(metadata));
}

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

// --- Hydration ---

describe('hydrateDatabase', () => {
  it('should populate SQLite from JSONL files', async () => {
    await withTempBrain(async (brainPath) => {
      writeJsonlEntry(brainPath, 'networking', 'fact', makeEntry({ id: 'fact001' }));
      writeJsonlEntry(
        brainPath,
        'networking',
        'decision',
        makeEntry({ id: 'dec001', type: 'decision', text: 'Use CoreDNS over Bind' }),
      );
      writeJsonlEntry(
        brainPath,
        'ci-pipelines',
        'fact',
        makeEntry({ id: 'ci001', area: 'ci-pipelines', text: 'Runners use spot instances' }),
      );

      writeAreaJson(brainPath, {
        id: 'networking',
        name: 'Networking',
        summary: 'Network infrastructure',
        owner: 'jason',
        tags: ['net'],
        created: '2026-03-15',
        updated: '2026-03-15',
      });

      const db = createDatabase(':memory:');
      hydrateDatabase(db, brainPath);

      const netEntries = queryEntries(db, { area: 'networking' });
      expect(netEntries).toHaveLength(2);

      const ciEntries = queryEntries(db, { area: 'ci-pipelines' });
      expect(ciEntries).toHaveLength(1);

      const areas = listAreas(db);
      expect(areas).toHaveLength(1);
      expect(areas[0].id).toBe('networking');

      // Should set last_hydrated
      const lastHydrated = getLastHydrated(db);
      expect(lastHydrated).not.toBeNull();

      db.close();
    });
  });

  it('should handle tombstones by excluding deleted entries', async () => {
    await withTempBrain(async (brainPath) => {
      writeJsonlEntry(brainPath, 'networking', 'fact', makeEntry({ id: 'fact001' }));
      writeJsonlEntry(brainPath, 'networking', 'fact', makeEntry({ id: 'fact002', text: 'Another fact' }));
      writeTombstone(brainPath, 'networking', 'fact', 'fact001');

      const db = createDatabase(':memory:');
      hydrateDatabase(db, brainPath);

      const entries = queryEntries(db, { area: 'networking' });
      expect(entries).toHaveLength(1);
      expect(entries[0].id).toBe('fact002');

      db.close();
    });
  });

  it('should handle latest-wins for same ID', async () => {
    await withTempBrain(async (brainPath) => {
      writeJsonlEntry(brainPath, 'networking', 'fact', makeEntry({ id: 'fact001', text: 'old text' }));
      writeJsonlEntry(
        brainPath,
        'networking',
        'fact',
        makeEntry({ id: 'fact001', text: 'new text', updated: '2026-03-15T11:00:00Z' }),
      );

      const db = createDatabase(':memory:');
      hydrateDatabase(db, brainPath);

      const entries = queryEntries(db, { area: 'networking' });
      expect(entries).toHaveLength(1);
      expect(entries[0].text).toBe('new text');

      db.close();
    });
  });

  it('should handle empty brain directory', async () => {
    await withTempBrain(async (brainPath) => {
      fs.mkdirSync(path.join(brainPath, 'areas'), { recursive: true });

      const db = createDatabase(':memory:');
      hydrateDatabase(db, brainPath);

      const entries = queryEntries(db, {});
      expect(entries).toHaveLength(0);

      db.close();
    });
  });

  it('should skip malformed JSONL lines', async () => {
    await withTempBrain(async (brainPath) => {
      const areaDir = path.join(brainPath, 'areas', 'networking');
      fs.mkdirSync(areaDir, { recursive: true });

      const filePath = path.join(areaDir, 'facts.jsonl');
      fs.writeFileSync(filePath, JSON.stringify(makeEntry({ id: 'good001' })) + '\n');
      fs.appendFileSync(filePath, '{bad json line\n');
      fs.appendFileSync(filePath, JSON.stringify(makeEntry({ id: 'good002', text: 'second fact' })) + '\n');

      const db = createDatabase(':memory:');
      hydrateDatabase(db, brainPath);

      const entries = queryEntries(db, { area: 'networking' });
      expect(entries).toHaveLength(2);

      db.close();
    });
  });
});

// --- Staleness ---

describe('isStale', () => {
  it('should return true when JSONL file mtime is after last_hydrated', async () => {
    await withTempBrain(async (brainPath) => {
      const db = createDatabase(':memory:');

      // Set last_hydrated to past
      const pastTime = new Date(Date.now() - 60000).toISOString();
      db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('last_hydrated', ?)").run(pastTime);

      // Create a JSONL file (mtime will be now, after last_hydrated)
      writeJsonlEntry(brainPath, 'networking', 'fact', makeEntry());

      expect(isStale(db, brainPath)).toBe(true);

      db.close();
    });
  });

  it('should return false when cache is current', async () => {
    await withTempBrain(async (brainPath) => {
      // Create JSONL file first
      writeJsonlEntry(brainPath, 'networking', 'fact', makeEntry());

      const db = createDatabase(':memory:');

      // Set last_hydrated to the future (well after the file was created)
      const futureTime = new Date(Date.now() + 60000).toISOString();
      db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('last_hydrated', ?)").run(futureTime);

      expect(isStale(db, brainPath)).toBe(false);

      db.close();
    });
  });

  it('should return true when last_hydrated is not set', async () => {
    await withTempBrain(async (brainPath) => {
      writeJsonlEntry(brainPath, 'networking', 'fact', makeEntry());

      const db = createDatabase(':memory:');
      expect(isStale(db, brainPath)).toBe(true);

      db.close();
    });
  });

  it('should return false when no brain files exist', async () => {
    await withTempBrain(async (brainPath) => {
      const db = createDatabase(':memory:');
      expect(isStale(db, brainPath)).toBe(false);
      db.close();
    });
  });
});

describe('ensureFresh', () => {
  it('should hydrate when stale', async () => {
    await withTempBrain(async (brainPath) => {
      writeJsonlEntry(brainPath, 'networking', 'fact', makeEntry({ id: 'fact001' }));

      const db = createDatabase(':memory:');

      // No last_hydrated set, so it's stale
      ensureFresh(db, brainPath);

      const entries = queryEntries(db, { area: 'networking' });
      expect(entries).toHaveLength(1);
      expect(entries[0].id).toBe('fact001');

      db.close();
    });
  });

  it('should skip hydration when fresh', async () => {
    await withTempBrain(async (brainPath) => {
      writeJsonlEntry(brainPath, 'networking', 'fact', makeEntry({ id: 'fact001' }));

      const db = createDatabase(':memory:');

      // Hydrate once
      hydrateDatabase(db, brainPath);
      const firstHydrated = getLastHydrated(db);

      // ensureFresh should not re-hydrate
      ensureFresh(db, brainPath);
      const secondHydrated = getLastHydrated(db);

      // Timestamps should be the same (no re-hydration)
      expect(firstHydrated).toBe(secondHydrated);

      db.close();
    });
  });
});
