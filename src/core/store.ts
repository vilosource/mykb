import fs from 'node:fs';
import path from 'node:path';
import type { KnowledgeEntry, EntryType, TombstoneEntry } from './types.js';

const TYPE_TO_FILENAME: Record<EntryType, string> = {
  fact: 'facts.jsonl',
  decision: 'decisions.jsonl',
  gotcha: 'gotchas.jsonl',
  pattern: 'patterns.jsonl',
  link: 'links.jsonl',
};

const JSONL_FILENAMES = Object.values(TYPE_TO_FILENAME);

function resolveJsonlPath(brainPath: string, area: string, entryType: EntryType): string {
  return path.join(brainPath, 'areas', area, TYPE_TO_FILENAME[entryType]);
}

function ensureDirectory(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function isTombstone(line: Record<string, unknown>): line is TombstoneEntry {
  return line.deleted === true;
}

function parseJsonlFile(filePath: string): Array<KnowledgeEntry | TombstoneEntry> {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const content = fs.readFileSync(filePath, 'utf-8').trim();
  if (content === '') {
    return [];
  }

  const results: Array<KnowledgeEntry | TombstoneEntry> = [];
  const lines = content.split('\n');

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as KnowledgeEntry | TombstoneEntry;
      results.push(parsed);
    } catch {
      // Skip malformed JSON lines
    }
  }

  return results;
}

function resolveEntries(parsed: Array<KnowledgeEntry | TombstoneEntry>): KnowledgeEntry[] {
  const entryMap = new Map<string, KnowledgeEntry | null>();

  for (const item of parsed) {
    if (isTombstone(item)) {
      entryMap.set(item.id, null);
    } else {
      entryMap.set(item.id, item);
    }
  }

  const results: KnowledgeEntry[] = [];
  for (const entry of entryMap.values()) {
    if (entry !== null) {
      results.push(entry);
    }
  }

  return results;
}

export function appendEntry(brainPath: string, area: string, entry: KnowledgeEntry): void {
  const filePath = resolveJsonlPath(brainPath, area, entry.type);
  ensureDirectory(filePath);
  fs.appendFileSync(filePath, JSON.stringify(entry) + '\n');
}

export function readEntries(brainPath: string, area: string, type: EntryType): KnowledgeEntry[] {
  const filePath = resolveJsonlPath(brainPath, area, type);
  const parsed = parseJsonlFile(filePath);
  return resolveEntries(parsed);
}

export function readAllEntries(brainPath: string, area: string): KnowledgeEntry[] {
  const areaDir = path.join(brainPath, 'areas', area);
  if (!fs.existsSync(areaDir)) {
    return [];
  }

  const allEntries: KnowledgeEntry[] = [];

  for (const filename of JSONL_FILENAMES) {
    const filePath = path.join(areaDir, filename);
    const parsed = parseJsonlFile(filePath);
    const resolved = resolveEntries(parsed);
    allEntries.push(...resolved);
  }

  return allEntries;
}

export function writeTombstone(
  brainPath: string,
  area: string,
  id: string,
  entryType: EntryType,
): void {
  const filePath = resolveJsonlPath(brainPath, area, entryType);
  ensureDirectory(filePath);

  const tombstone: TombstoneEntry = {
    id,
    area,
    deleted: true,
    updated: new Date().toISOString(),
  };

  fs.appendFileSync(filePath, JSON.stringify(tombstone) + '\n');
}

export function compactEntries(brainPath: string, area: string, type?: EntryType): void {
  const types: EntryType[] = type
    ? [type]
    : (['fact', 'decision', 'gotcha', 'pattern', 'link'] as EntryType[]);

  for (const t of types) {
    const filePath = resolveJsonlPath(brainPath, area, t);
    if (!fs.existsSync(filePath)) {
      continue;
    }

    const parsed = parseJsonlFile(filePath);
    const resolved = resolveEntries(parsed);

    const compacted = resolved.map((entry) => JSON.stringify(entry)).join('\n');
    fs.writeFileSync(filePath, compacted + '\n');
  }
}
