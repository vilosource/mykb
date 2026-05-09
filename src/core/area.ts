import fs from 'node:fs';
import path from 'node:path';
import type { AreaMetadata } from './types.js';

function areaDir(brainPath: string, id: string): string {
  return path.join(brainPath, 'areas', id);
}

function areaJsonPath(brainPath: string, id: string): string {
  return path.join(areaDir(brainPath, id), 'area.json');
}

export function createArea(
  brainPath: string,
  id: string,
  name: string,
  summary: string,
  tags: string[] = [],
): AreaMetadata {
  const dir = areaDir(brainPath, id);
  fs.mkdirSync(dir, { recursive: true });

  const now = new Date().toISOString();
  const metadata: AreaMetadata = {
    id,
    name,
    summary,
    owner: '',
    tags,
    created: now,
    updated: now,
  };

  fs.writeFileSync(areaJsonPath(brainPath, id), JSON.stringify(metadata, null, 2) + '\n');
  return metadata;
}

export function readAreaMetadata(brainPath: string, id: string): AreaMetadata | null {
  const jsonPath = areaJsonPath(brainPath, id);
  if (!fs.existsSync(jsonPath)) {
    return null;
  }

  const content = fs.readFileSync(jsonPath, 'utf-8');
  return JSON.parse(content) as AreaMetadata;
}

export function updateAreaMetadata(
  brainPath: string,
  id: string,
  updates: Partial<Omit<AreaMetadata, 'id' | 'created'>>,
): AreaMetadata {
  const existing = readAreaMetadata(brainPath, id);
  if (!existing) {
    throw new Error(`Area '${id}' not found`);
  }

  const updated: AreaMetadata = {
    ...existing,
    ...updates,
    id: existing.id,
    created: existing.created,
    updated: new Date().toISOString(),
  };

  fs.writeFileSync(areaJsonPath(brainPath, id), JSON.stringify(updated, null, 2) + '\n');
  return updated;
}

export function listAreas(brainPath: string): AreaMetadata[] {
  const areasDir = path.join(brainPath, 'areas');
  if (!fs.existsSync(areasDir)) {
    return [];
  }

  const entries = fs.readdirSync(areasDir, { withFileTypes: true });
  const areas: AreaMetadata[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const metadata = readAreaMetadata(brainPath, entry.name);
      if (metadata) {
        areas.push(metadata);
      }
    }
  }

  return areas;
}

export function areaExists(brainPath: string, id: string): boolean {
  return fs.existsSync(areaJsonPath(brainPath, id));
}

export function deleteArea(brainPath: string, id: string): void {
  const dir = areaDir(brainPath, id);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
