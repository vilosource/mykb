import fs from 'node:fs';
import path from 'node:path';
import type { ManifestFile, ManifestArea } from './types.js';
import { listAreas } from './area.js';

export function regenerateManifest(brainPath: string): ManifestFile {
  const areas = listAreas(brainPath);

  const manifestAreas: ManifestArea[] = areas.map((area) => ({
    id: area.id,
    summary: area.summary,
    owner: area.owner,
    updated: area.updated,
    tags: area.tags ?? [],
  }));

  const manifest: ManifestFile = {
    version: 1,
    areas: manifestAreas,
  };

  const manifestPath = path.join(brainPath, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  return manifest;
}

export function readManifest(brainPath: string): ManifestFile | null {
  const manifestPath = path.join(brainPath, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    return null;
  }

  const content = fs.readFileSync(manifestPath, 'utf-8');
  const raw = JSON.parse(content) as { version: number; areas: Partial<ManifestArea>[] };
  // Backward compat: older manifests don't have the tags field. Default
  // to [] so the scorer doesn't choke on legacy brains. (Bug surfaced by
  // experiments/area-scoring/.)
  const areas: ManifestArea[] = raw.areas.map((a) => ({
    id: a.id ?? '',
    summary: a.summary ?? '',
    owner: a.owner ?? '',
    updated: a.updated ?? '',
    tags: a.tags ?? [],
  }));
  return { version: raw.version, areas };
}
