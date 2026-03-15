import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { upsertEntry, deleteEntry, upsertArea, getLastHydrated, setLastHydrated } from './db.js';
import type { KnowledgeEntry, AreaMetadata } from './types.js';

const JSONL_FILES = [
  'facts.jsonl',
  'decisions.jsonl',
  'gotchas.jsonl',
  'patterns.jsonl',
  'links.jsonl',
];

type JsonlLine = KnowledgeEntry | { id: string; deleted: true; [key: string]: unknown };

function isTombstone(
  line: JsonlLine,
): line is { id: string; deleted: true; [key: string]: unknown } {
  return 'deleted' in line && line.deleted === true;
}

function parseJsonlFile(filePath: string): JsonlLine[] {
  if (!fs.existsSync(filePath)) return [];

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter((l) => l.trim() !== '');
  const parsed: JsonlLine[] = [];

  for (const line of lines) {
    try {
      parsed.push(JSON.parse(line) as JsonlLine);
    } catch {
      // Skip malformed lines
    }
  }

  return parsed;
}

function getAreaDirectories(brainPath: string): string[] {
  const areasDir = path.join(brainPath, 'areas');
  if (!fs.existsSync(areasDir)) return [];

  return fs
    .readdirSync(areasDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

function getMaxMtime(brainPath: string): Date | null {
  const areasDir = path.join(brainPath, 'areas');
  if (!fs.existsSync(areasDir)) return null;

  let maxMtime: Date | null = null;
  const areas = getAreaDirectories(brainPath);

  for (const area of areas) {
    const areaDir = path.join(areasDir, area);

    // Check area.json
    const areaJsonPath = path.join(areaDir, 'area.json');
    if (fs.existsSync(areaJsonPath)) {
      const stat = fs.statSync(areaJsonPath);
      if (!maxMtime || stat.mtime > maxMtime) {
        maxMtime = stat.mtime;
      }
    }

    // Check JSONL files
    for (const file of JSONL_FILES) {
      const filePath = path.join(areaDir, file);
      if (fs.existsSync(filePath)) {
        const stat = fs.statSync(filePath);
        if (!maxMtime || stat.mtime > maxMtime) {
          maxMtime = stat.mtime;
        }
      }
    }
  }

  // Check manifest.json
  const manifestPath = path.join(brainPath, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    const stat = fs.statSync(manifestPath);
    if (!maxMtime || stat.mtime > maxMtime) {
      maxMtime = stat.mtime;
    }
  }

  return maxMtime;
}

export function hydrateDatabase(db: Database.Database, brainPath: string): void {
  const areas = getAreaDirectories(brainPath);

  for (const area of areas) {
    const areaDir = path.join(brainPath, 'areas', area);

    // Load area.json metadata if it exists
    const areaJsonPath = path.join(areaDir, 'area.json');
    if (fs.existsSync(areaJsonPath)) {
      try {
        const content = fs.readFileSync(areaJsonPath, 'utf-8');
        const metadata = JSON.parse(content) as AreaMetadata;
        upsertArea(db, metadata);
      } catch {
        // Skip malformed area.json
      }
    }

    // Process JSONL files: collect all lines, apply latest-wins and tombstone logic
    const entryMap = new Map<string, KnowledgeEntry>();
    const tombstones = new Set<string>();

    for (const file of JSONL_FILES) {
      const filePath = path.join(areaDir, file);
      const lines = parseJsonlFile(filePath);

      for (const line of lines) {
        if (isTombstone(line)) {
          tombstones.add(line.id);
          entryMap.delete(line.id);
        } else {
          tombstones.delete(line.id);
          entryMap.set(line.id, line);
        }
      }
    }

    // Upsert surviving entries
    for (const entry of entryMap.values()) {
      upsertEntry(db, entry);
    }

    // Delete tombstoned entries (in case they were in DB from a previous hydration)
    for (const id of tombstones) {
      deleteEntry(db, id);
    }
  }

  setLastHydrated(db, new Date().toISOString());
}

export function isStale(db: Database.Database, brainPath: string): boolean {
  const maxMtime = getMaxMtime(brainPath);
  if (!maxMtime) return false;

  const lastHydrated = getLastHydrated(db);
  if (!lastHydrated) return true;

  const lastHydratedDate = new Date(lastHydrated);
  return maxMtime > lastHydratedDate;
}

export function ensureFresh(db: Database.Database, brainPath: string): void {
  if (isStale(db, brainPath)) {
    hydrateDatabase(db, brainPath);
  }
}
