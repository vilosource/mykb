import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { withTempBrain } from '../helpers.js';
import {
  appendEntry,
  readEntries,
  readAllEntries,
  writeTombstone,
  compactEntries,
} from '../../src/core/store.js';
import { areaExists, readAreaMetadata } from '../../src/core/area.js';
import {
  type KnowledgeEntry,
  type TombstoneEntry,
  ProvenanceStatus,
  Zone,
} from '../../src/core/types.js';

function makeFactEntry(overrides: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
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

describe('appendEntry', () => {
  it('should create JSONL file and write one JSON line', async () => {
    await withTempBrain(async (brainPath) => {
      const entry = makeFactEntry();
      appendEntry(brainPath, 'networking', entry);

      const filePath = path.join(brainPath, 'areas', 'networking', 'facts.jsonl');
      expect(fs.existsSync(filePath)).toBe(true);

      const content = fs.readFileSync(filePath, 'utf-8').trim();
      const parsed = JSON.parse(content) as KnowledgeEntry;
      expect(parsed.id).toBe('testid01');
      expect(parsed.text).toBe('DNS uses CoreDNS');
      expect(parsed.type).toBe('fact');
    });
  });

  it('should map entry type to correct filename', async () => {
    const typeToFile: Array<[KnowledgeEntry['type'], string]> = [
      ['fact', 'facts.jsonl'],
      ['decision', 'decisions.jsonl'],
      ['gotcha', 'gotchas.jsonl'],
      ['pattern', 'patterns.jsonl'],
      ['link', 'links.jsonl'],
    ];

    for (const [entryType, expectedFile] of typeToFile) {
      await withTempBrain(async (brainPath) => {
        const entry = makeFactEntry({ type: entryType as KnowledgeEntry['type'] });
        appendEntry(brainPath, 'networking', entry);

        const filePath = path.join(brainPath, 'areas', 'networking', expectedFile);
        expect(fs.existsSync(filePath), `${entryType} should create ${expectedFile}`).toBe(true);
      });
    }
  });

  it('should append multiple entries to the same file', async () => {
    await withTempBrain(async (brainPath) => {
      const entry1 = makeFactEntry({ id: 'id000001', text: 'first fact' });
      const entry2 = makeFactEntry({ id: 'id000002', text: 'second fact' });

      appendEntry(brainPath, 'networking', entry1);
      appendEntry(brainPath, 'networking', entry2);

      const filePath = path.join(brainPath, 'areas', 'networking', 'facts.jsonl');
      const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n');
      expect(lines).toHaveLength(2);

      const parsed1 = JSON.parse(lines[0]) as KnowledgeEntry;
      const parsed2 = JSON.parse(lines[1]) as KnowledgeEntry;
      expect(parsed1.text).toBe('first fact');
      expect(parsed2.text).toBe('second fact');
    });
  });
});

describe('readEntries', () => {
  const cases = [
    {
      name: 'should return appended entry',
      setup: (brainPath: string) => {
        const entry = makeFactEntry();
        appendEntry(brainPath, 'networking', entry);
      },
      expected: (entries: KnowledgeEntry[]) => {
        expect(entries).toHaveLength(1);
        expect(entries[0].id).toBe('testid01');
        expect(entries[0].text).toBe('DNS uses CoreDNS');
      },
    },
    {
      name: 'should return only latest entry when same ID appears twice (last line wins)',
      setup: (brainPath: string) => {
        const entry1 = makeFactEntry({ text: 'old text' });
        const entry2 = makeFactEntry({ text: 'new text', updated: '2026-03-15T11:00:00Z' });
        appendEntry(brainPath, 'networking', entry1);
        appendEntry(brainPath, 'networking', entry2);
      },
      expected: (entries: KnowledgeEntry[]) => {
        expect(entries).toHaveLength(1);
        expect(entries[0].text).toBe('new text');
      },
    },
    {
      name: 'should exclude tombstoned entries',
      setup: (brainPath: string) => {
        const entry = makeFactEntry();
        appendEntry(brainPath, 'networking', entry);
        writeTombstone(brainPath, 'networking', 'testid01', 'fact');
      },
      expected: (entries: KnowledgeEntry[]) => {
        expect(entries).toHaveLength(0);
      },
    },
  ] as const;

  for (const { name, setup, expected } of cases) {
    it(name, async () => {
      await withTempBrain(async (brainPath) => {
        setup(brainPath);
        const entries = readEntries(brainPath, 'networking', 'fact');
        expected(entries);
      });
    });
  }

  it('should return empty array when JSONL file does not exist', async () => {
    await withTempBrain(async (brainPath) => {
      const entries = readEntries(brainPath, 'networking', 'fact');
      expect(entries).toEqual([]);
    });
  });
});

describe('readAllEntries', () => {
  it('should read entries across all JSONL files in area', async () => {
    await withTempBrain(async (brainPath) => {
      const fact = makeFactEntry({ id: 'fact0001' });
      const decision = makeFactEntry({ id: 'deci0001', type: 'decision' });

      appendEntry(brainPath, 'networking', fact);
      appendEntry(brainPath, 'networking', decision);

      const entries = readAllEntries(brainPath, 'networking');
      expect(entries).toHaveLength(2);

      const ids = entries.map((e) => e.id).sort();
      expect(ids).toEqual(['deci0001', 'fact0001']);
    });
  });

  it('should return empty array when area directory does not exist', async () => {
    await withTempBrain(async (brainPath) => {
      const entries = readAllEntries(brainPath, 'nonexistent');
      expect(entries).toEqual([]);
    });
  });
});

describe('writeTombstone', () => {
  it('should append tombstone line to the correct JSONL file', async () => {
    await withTempBrain(async (brainPath) => {
      const entry = makeFactEntry();
      appendEntry(brainPath, 'networking', entry);
      writeTombstone(brainPath, 'networking', 'testid01', 'fact');

      const filePath = path.join(brainPath, 'areas', 'networking', 'facts.jsonl');
      const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n');
      expect(lines).toHaveLength(2);

      const tombstone = JSON.parse(lines[1]) as TombstoneEntry;
      expect(tombstone.id).toBe('testid01');
      expect(tombstone.deleted).toBe(true);
      expect(tombstone.area).toBe('networking');
      expect(tombstone.updated).toBeDefined();
    });
  });
});

describe('compactEntries', () => {
  it('should rewrite JSONL with only latest per ID and no tombstones', async () => {
    await withTempBrain(async (brainPath) => {
      const entry1 = makeFactEntry({ text: 'old text' });
      const entry2 = makeFactEntry({ text: 'new text', updated: '2026-03-15T11:00:00Z' });
      const entry3 = makeFactEntry({ id: 'other001', text: 'other fact' });

      appendEntry(brainPath, 'networking', entry1);
      appendEntry(brainPath, 'networking', entry2);
      appendEntry(brainPath, 'networking', entry3);
      writeTombstone(brainPath, 'networking', 'other001', 'fact');

      compactEntries(brainPath, 'networking', 'fact');

      const filePath = path.join(brainPath, 'areas', 'networking', 'facts.jsonl');
      const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n');
      expect(lines).toHaveLength(1);

      const parsed = JSON.parse(lines[0]) as KnowledgeEntry;
      expect(parsed.id).toBe('testid01');
      expect(parsed.text).toBe('new text');
    });
  });

  it('should be idempotent — running twice produces same result', async () => {
    await withTempBrain(async (brainPath) => {
      const entry = makeFactEntry();
      appendEntry(brainPath, 'networking', entry);

      compactEntries(brainPath, 'networking', 'fact');
      const filePath = path.join(brainPath, 'areas', 'networking', 'facts.jsonl');
      const afterFirst = fs.readFileSync(filePath, 'utf-8');

      compactEntries(brainPath, 'networking', 'fact');
      const afterSecond = fs.readFileSync(filePath, 'utf-8');

      expect(afterFirst).toBe(afterSecond);
    });
  });
});

describe('malformed JSONL handling', () => {
  it('should skip malformed JSON lines and return valid entries', async () => {
    await withTempBrain(async (brainPath) => {
      const entry = makeFactEntry();
      appendEntry(brainPath, 'networking', entry);

      // Manually append a malformed line
      const filePath = path.join(brainPath, 'areas', 'networking', 'facts.jsonl');
      fs.appendFileSync(filePath, '{bad json\n');

      const entry2 = makeFactEntry({ id: 'valid002', text: 'valid entry' });
      appendEntry(brainPath, 'networking', entry2);

      const entries = readEntries(brainPath, 'networking', 'fact');
      expect(entries).toHaveLength(2);
      expect(entries.map((e) => e.id).sort()).toEqual(['testid01', 'valid002']);
    });
  });
});

describe('auto-create area on appendEntry', () => {
  it('should auto-create area directory with default area.json when area does not exist', async () => {
    await withTempBrain(async (brainPath) => {
      const entry = makeFactEntry({ area: 'new-area' });
      appendEntry(brainPath, 'new-area', entry);

      expect(areaExists(brainPath, 'new-area')).toBe(true);

      const metadata = readAreaMetadata(brainPath, 'new-area');
      expect(metadata).not.toBeNull();
      expect(metadata!.id).toBe('new-area');
      expect(metadata!.name).toBe('new-area');
      expect(metadata!.summary).toBe('');

      const entries = readEntries(brainPath, 'new-area', 'fact');
      expect(entries).toHaveLength(1);
      expect(entries[0].text).toBe('DNS uses CoreDNS');
    });
  });
});
