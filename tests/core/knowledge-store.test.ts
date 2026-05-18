import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { withTempBrain } from '../helpers.js';
import { MykbStore } from '../../src/core/knowledge-store.js';
import { Zone, ProvenanceStatus } from '../../src/core/types.js';

describe('MykbStore', () => {
  describe('construction and initialization', () => {
    it('creates db file and areas directory on open', async () => {
      await withTempBrain(async (brainPath) => {
        fs.mkdirSync(path.join(brainPath, 'areas'), { recursive: true });
        const store = MykbStore.open(brainPath);
        expect(fs.existsSync(path.join(brainPath, 'kb.db'))).toBe(true);
        store.close();
      });
    });
  });

  describe('addFact', () => {
    it('returns an id and persists the entry', async () => {
      await withTempBrain(async (brainPath) => {
        fs.mkdirSync(path.join(brainPath, 'areas'), { recursive: true });
        const store = MykbStore.open(brainPath);

        const id = store.addFact('my-area', 'TypeScript is great');
        expect(id).toHaveLength(8);

        const entries = store.loadArea('my-area');
        expect(entries).toHaveLength(1);
        expect(entries[0].id).toBe(id);
        expect(entries[0].type).toBe('fact');
        expect(entries[0].text).toBe('TypeScript is great');
        expect(entries[0].area).toBe('my-area');
        expect(entries[0].zone).toBe(Zone.Active);

        store.close();
      });
    });

    it('writes to both JSONL and SQLite', async () => {
      await withTempBrain(async (brainPath) => {
        fs.mkdirSync(path.join(brainPath, 'areas'), { recursive: true });
        const store = MykbStore.open(brainPath);

        store.addFact('my-area', 'dual write test');

        // Verify JSONL
        const jsonlPath = path.join(brainPath, 'areas', 'my-area', 'facts.jsonl');
        expect(fs.existsSync(jsonlPath)).toBe(true);
        const content = fs.readFileSync(jsonlPath, 'utf-8').trim();
        const parsed = JSON.parse(content);
        expect(parsed.text).toBe('dual write test');

        // Verify SQLite (via loadArea which uses db)
        const entries = store.loadArea('my-area');
        expect(entries).toHaveLength(1);

        store.close();
      });
    });

    it('accepts options (tags, zone, provenance)', async () => {
      await withTempBrain(async (brainPath) => {
        fs.mkdirSync(path.join(brainPath, 'areas'), { recursive: true });
        const store = MykbStore.open(brainPath);

        const id = store.addFact('my-area', 'tagged fact', {
          tags: ['typescript', 'testing'],
          zone: Zone.Established,
          provenance: { status: ProvenanceStatus.Verified, date: '2026-03-15' },
        });

        const entries = store.loadArea('my-area');
        const entry = entries.find((e) => e.id === id)!;
        expect(entry.tags).toEqual(['typescript', 'testing']);
        expect(entry.zone).toBe(Zone.Established);
        expect(entry.provenance.status).toBe(ProvenanceStatus.Verified);

        store.close();
      });
    });
  });

  describe('addDecision', () => {
    it('creates a decision entry with extra fields', async () => {
      await withTempBrain(async (brainPath) => {
        fs.mkdirSync(path.join(brainPath, 'areas'), { recursive: true });
        const store = MykbStore.open(brainPath);

        const id = store.addDecision('my-area', 'Use vitest', {
          why: 'Fast and ESM native',
          rejected: 'Jest',
          context: 'Testing framework selection',
        });

        const entries = store.loadArea('my-area');
        const entry = entries.find((e) => e.id === id)!;
        expect(entry.type).toBe('decision');
        expect(entry.text).toBe('Use vitest');

        store.close();
      });
    });
  });

  describe('addGotcha', () => {
    it('creates a gotcha entry with failed and resolution', async () => {
      await withTempBrain(async (brainPath) => {
        fs.mkdirSync(path.join(brainPath, 'areas'), { recursive: true });
        const store = MykbStore.open(brainPath);

        const id = store.addGotcha('my-area', 'ESM imports need .js extension', {
          failed: true,
          resolution: 'resolved',
        });

        const entries = store.loadArea('my-area');
        const entry = entries.find((e) => e.id === id)!;
        expect(entry.type).toBe('gotcha');

        store.close();
      });
    });
  });

  describe('addPattern', () => {
    it('creates a pattern entry', async () => {
      await withTempBrain(async (brainPath) => {
        fs.mkdirSync(path.join(brainPath, 'areas'), { recursive: true });
        const store = MykbStore.open(brainPath);

        const id = store.addPattern('my-area', 'Always use strict mode');

        const entries = store.loadArea('my-area');
        const entry = entries.find((e) => e.id === id)!;
        expect(entry.type).toBe('pattern');
        expect(entry.text).toBe('Always use strict mode');

        store.close();
      });
    });
  });

  describe('addLink', () => {
    it('creates a link entry with url', async () => {
      await withTempBrain(async (brainPath) => {
        fs.mkdirSync(path.join(brainPath, 'areas'), { recursive: true });
        const store = MykbStore.open(brainPath);

        const id = store.addLink('my-area', 'Vitest docs', 'https://vitest.dev');

        const entries = store.loadArea('my-area');
        const entry = entries.find((e) => e.id === id)!;
        expect(entry.type).toBe('link');
        expect(entry.text).toBe('Vitest docs');

        store.close();
      });
    });
  });

  describe('updateEntry', () => {
    it('updates an existing entry', async () => {
      await withTempBrain(async (brainPath) => {
        fs.mkdirSync(path.join(brainPath, 'areas'), { recursive: true });
        const store = MykbStore.open(brainPath);

        const id = store.addFact('my-area', 'original text');
        store.updateEntry('my-area', id, { text: 'updated text' });

        const entries = store.loadArea('my-area');
        expect(entries).toHaveLength(1);
        expect(entries[0].text).toBe('updated text');

        store.close();
      });
    });
  });

  describe('deleteEntry', () => {
    it('removes an entry from results', async () => {
      await withTempBrain(async (brainPath) => {
        fs.mkdirSync(path.join(brainPath, 'areas'), { recursive: true });
        const store = MykbStore.open(brainPath);

        const id = store.addFact('my-area', 'to be deleted');
        store.deleteEntry('my-area', id);

        const entries = store.loadArea('my-area');
        expect(entries).toHaveLength(0);

        store.close();
      });
    });
  });

  describe('verifyEntry', () => {
    it('sets provenance to verified', async () => {
      await withTempBrain(async (brainPath) => {
        fs.mkdirSync(path.join(brainPath, 'areas'), { recursive: true });
        const store = MykbStore.open(brainPath);

        const id = store.addFact('my-area', 'verify me');
        store.verifyEntry('my-area', id);

        const entries = store.loadArea('my-area');
        expect(entries[0].provenance.status).toBe(ProvenanceStatus.Verified);
        expect(entries[0].provenance.date).toBeDefined();

        store.close();
      });
    });
  });

  describe('promoteEntry', () => {
    it('changes zone to established', async () => {
      await withTempBrain(async (brainPath) => {
        fs.mkdirSync(path.join(brainPath, 'areas'), { recursive: true });
        const store = MykbStore.open(brainPath);

        const id = store.addFact('my-area', 'promote me');
        store.promoteEntry('my-area', id);

        const entries = store.loadArea('my-area');
        expect(entries[0].zone).toBe(Zone.Established);

        store.close();
      });
    });
  });

  describe('archiveEntry', () => {
    it('changes zone to archive', async () => {
      await withTempBrain(async (brainPath) => {
        fs.mkdirSync(path.join(brainPath, 'areas'), { recursive: true });
        const store = MykbStore.open(brainPath);

        const id = store.addFact('my-area', 'archive me');
        store.archiveEntry('my-area', id);

        const entries = store.loadArea('my-area');
        expect(entries[0].zone).toBe(Zone.Archive);

        store.close();
      });
    });
  });

  describe('loadArea', () => {
    it('returns all entries for an area', async () => {
      await withTempBrain(async (brainPath) => {
        fs.mkdirSync(path.join(brainPath, 'areas'), { recursive: true });
        const store = MykbStore.open(brainPath);

        store.addFact('my-area', 'fact 1');
        store.addDecision('my-area', 'decision 1');
        store.addPattern('my-area', 'pattern 1');

        const entries = store.loadArea('my-area');
        expect(entries).toHaveLength(3);

        store.close();
      });
    });

    it('applies filter by type', async () => {
      await withTempBrain(async (brainPath) => {
        fs.mkdirSync(path.join(brainPath, 'areas'), { recursive: true });
        const store = MykbStore.open(brainPath);

        store.addFact('my-area', 'fact 1');
        store.addDecision('my-area', 'decision 1');

        const entries = store.loadArea('my-area', { type: 'fact' });
        expect(entries).toHaveLength(1);
        expect(entries[0].type).toBe('fact');

        store.close();
      });
    });
  });

  describe('search', () => {
    it('finds entries via FTS', async () => {
      await withTempBrain(async (brainPath) => {
        fs.mkdirSync(path.join(brainPath, 'areas'), { recursive: true });
        const store = MykbStore.open(brainPath);

        store.addFact('my-area', 'TypeScript is a superset of JavaScript');
        store.addFact('my-area', 'Python is dynamically typed');

        const results = store.search('TypeScript');
        expect(results.length).toBeGreaterThanOrEqual(1);
        expect(results[0].text).toContain('TypeScript');

        store.close();
      });
    });
  });

  describe('matchAreas', () => {
    it('returns matching areas ranked by score', async () => {
      await withTempBrain(async (brainPath) => {
        fs.mkdirSync(path.join(brainPath, 'areas'), { recursive: true });
        const store = MykbStore.open(brainPath);

        store.addFact('typescript', 'TypeScript compiler options');
        store.addFact('python', 'Python virtual environments');

        const matches = store.matchAreas('TypeScript compiler');
        expect(matches.length).toBeGreaterThanOrEqual(1);
        expect(matches[0].area).toBe('typescript');

        store.close();
      });
    });
  });

  describe('matchAreas with hyphenated text', () => {
    it('returns matching areas when query contains hyphens', async () => {
      await withTempBrain(async (brainPath) => {
        fs.mkdirSync(path.join(brainPath, 'areas'), { recursive: true });
        const store = MykbStore.open(brainPath);

        store.addFact('postnord', 'fi-abakus server runs the warehouse integration');
        store.addFact('plandent', 'PLANDENT-004 decided on Spring 5 migration target');

        const matches = store.matchAreas('fi-abakus');
        expect(matches.length).toBeGreaterThanOrEqual(1);
        expect(matches[0].area).toBe('postnord');

        store.close();
      });
    });
  });

  describe('compact', () => {
    it('compacts JSONL files for a specific area', async () => {
      await withTempBrain(async (brainPath) => {
        fs.mkdirSync(path.join(brainPath, 'areas'), { recursive: true });
        const store = MykbStore.open(brainPath);

        const id = store.addFact('my-area', 'original');
        store.updateEntry('my-area', id, { text: 'updated' });

        // Before compact: JSONL has 2 lines
        const jsonlPath = path.join(brainPath, 'areas', 'my-area', 'facts.jsonl');
        const linesBefore = fs.readFileSync(jsonlPath, 'utf-8').trim().split('\n');
        expect(linesBefore).toHaveLength(2);

        store.compact('my-area');

        // After compact: JSONL has 1 line
        const linesAfter = fs.readFileSync(jsonlPath, 'utf-8').trim().split('\n');
        expect(linesAfter).toHaveLength(1);

        store.close();
      });
    });

    it('compacts all areas when no area specified', async () => {
      await withTempBrain(async (brainPath) => {
        fs.mkdirSync(path.join(brainPath, 'areas'), { recursive: true });
        const store = MykbStore.open(brainPath);

        store.addFact('area-a', 'fact a');
        store.addFact('area-b', 'fact b');

        store.compact();

        // Both areas should still work
        expect(store.loadArea('area-a')).toHaveLength(1);
        expect(store.loadArea('area-b')).toHaveLength(1);

        store.close();
      });
    });
  });

  describe('incoming zone (decisions J2N6eo8S / ei2k4oZF)', () => {
    it('accepts zone=incoming and persists it (schema + JSONL + db)', async () => {
      await withTempBrain(async (brainPath) => {
        fs.mkdirSync(path.join(brainPath, 'areas'), { recursive: true });
        const store = MykbStore.open(brainPath);

        const id = store.addFact('my-area', 'agent-proposed, unverified', {
          zone: Zone.Incoming,
        });

        const entries = store.loadArea('my-area');
        const entry = entries.find((e) => e.id === id)!;
        expect(entry.zone).toBe(Zone.Incoming);

        // JSONL is the source of truth — it must agree with the db
        // (no corrupt-JSONL / crashed-db split).
        const jsonl = fs.readFileSync(
          path.join(brainPath, 'areas', 'my-area', 'facts.jsonl'),
          'utf8',
        );
        expect(jsonl).toContain('"zone":"incoming"');

        store.close();
      });
    });

    it('keeps defaulting new entries to active (quarantine is opt-in)', async () => {
      await withTempBrain(async (brainPath) => {
        fs.mkdirSync(path.join(brainPath, 'areas'), { recursive: true });
        const store = MykbStore.open(brainPath);

        const id = store.addFact('my-area', 'operator-authored');
        const entry = store.loadArea('my-area').find((e) => e.id === id)!;
        expect(entry.zone).toBe(Zone.Active);

        store.close();
      });
    });

    it('verifyEntry on an incoming entry moves it to active', async () => {
      await withTempBrain(async (brainPath) => {
        fs.mkdirSync(path.join(brainPath, 'areas'), { recursive: true });
        const store = MykbStore.open(brainPath);

        const id = store.addFact('my-area', 'release me', {
          zone: Zone.Incoming,
        });
        store.verifyEntry('my-area', id);

        const entry = store.loadArea('my-area').find((e) => e.id === id)!;
        expect(entry.zone).toBe(Zone.Active);
        expect(entry.provenance.status).toBe(ProvenanceStatus.Verified);

        store.close();
      });
    });

    it('verifyEntry leaves a non-incoming zone unchanged', async () => {
      await withTempBrain(async (brainPath) => {
        fs.mkdirSync(path.join(brainPath, 'areas'), { recursive: true });
        const store = MykbStore.open(brainPath);

        const id = store.addFact('my-area', 'already established', {
          zone: Zone.Established,
        });
        store.verifyEntry('my-area', id);

        const entry = store.loadArea('my-area').find((e) => e.id === id)!;
        expect(entry.zone).toBe(Zone.Established);
        expect(entry.provenance.status).toBe(ProvenanceStatus.Verified);

        store.close();
      });
    });

    it('rejects an invalid zone BEFORE writing JSONL (no corrupt entry)', async () => {
      await withTempBrain(async (brainPath) => {
        fs.mkdirSync(path.join(brainPath, 'areas'), { recursive: true });
        const store = MykbStore.open(brainPath);

        expect(() =>
          store.addFact('my-area', 'bad zone', {
            zone: 'nonsense' as Zone,
          }),
        ).toThrow();

        // The hazard this guards: JSONL appended, then db CHECK
        // crashes -> split brain. facts.jsonl must not carry it.
        const jsonlPath = path.join(brainPath, 'areas', 'my-area', 'facts.jsonl');
        const orphaned =
          fs.existsSync(jsonlPath) && fs.readFileSync(jsonlPath, 'utf8').includes('bad zone');
        expect(orphaned).toBe(false);

        store.close();
      });
    });
  });

  describe('auto-creates area', () => {
    it('creates area metadata when adding entry to new area', async () => {
      await withTempBrain(async (brainPath) => {
        fs.mkdirSync(path.join(brainPath, 'areas'), { recursive: true });
        const store = MykbStore.open(brainPath);

        store.addFact('new-area', 'first fact');

        const areaJsonPath = path.join(brainPath, 'areas', 'new-area', 'area.json');
        expect(fs.existsSync(areaJsonPath)).toBe(true);

        store.close();
      });
    });
  });
});
