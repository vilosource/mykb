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
  return JSON.parse(content) as ManifestFile;
}
