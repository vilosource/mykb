import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { withTempBrain } from '../helpers.js';
import { createArea } from '../../src/core/area.js';
import { regenerateManifest, readManifest } from '../../src/core/manifest.js';
import type { ManifestFile } from '../../src/core/types.js';

describe('regenerateManifest', () => {
  it('should produce correct ManifestFile from area.json files', async () => {
    await withTempBrain(async (brainPath) => {
      createArea(brainPath, 'networking', 'Networking', 'Network knowledge');
      createArea(brainPath, 'ci-pipelines', 'CI Pipelines', 'CI/CD knowledge');

      regenerateManifest(brainPath);

      const manifestPath = path.join(brainPath, 'manifest.json');
      expect(fs.existsSync(manifestPath)).toBe(true);

      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as ManifestFile;
      expect(manifest.version).toBe(1);
      expect(manifest.areas).toHaveLength(2);

      const ids = manifest.areas.map((a) => a.id).sort();
      expect(ids).toEqual(['ci-pipelines', 'networking']);

      const networking = manifest.areas.find((a) => a.id === 'networking');
      expect(networking!.summary).toBe('Network knowledge');
      expect(networking!.updated).toBeDefined();
    });
  });

  it('should produce empty areas array when no areas exist', async () => {
    await withTempBrain(async (brainPath) => {
      regenerateManifest(brainPath);

      const manifestPath = path.join(brainPath, 'manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as ManifestFile;
      expect(manifest.version).toBe(1);
      expect(manifest.areas).toEqual([]);
    });
  });
});

describe('readManifest', () => {
  it('should return ManifestFile from manifest.json', async () => {
    await withTempBrain(async (brainPath) => {
      createArea(brainPath, 'networking', 'Networking', 'Network knowledge');
      regenerateManifest(brainPath);

      const manifest = readManifest(brainPath);
      expect(manifest).not.toBeNull();
      expect(manifest!.version).toBe(1);
      expect(manifest!.areas).toHaveLength(1);
      expect(manifest!.areas[0].id).toBe('networking');
    });
  });

  it('should return null when manifest.json does not exist', async () => {
    await withTempBrain(async (brainPath) => {
      const manifest = readManifest(brainPath);
      expect(manifest).toBeNull();
    });
  });
});

// Regression for experiments/area-scoring/: ManifestArea didn't include
// tags, so '--tags' on 'kb add fact' couldn't drive keyword scoring even
// when the manifest was fresh. context.ts:42-49 builds AreaMetadata with
// tags: [] hardcoded; the fix is to thread tags from area.json through
// the manifest into the AreaMetadata builder.
describe('manifest tags', () => {
  it('regenerateManifest populates tags from area metadata', async () => {
    await withTempBrain(async (brainPath) => {
      createArea(brainPath, 'networking', 'Networking', 'Network knowledge', ['dns', 'routing']);
      regenerateManifest(brainPath);

      const manifest = readManifest(brainPath);
      expect(manifest).not.toBeNull();
      const networking = manifest!.areas.find((a) => a.id === 'networking');
      expect(networking?.tags).toEqual(['dns', 'routing']);
    });
  });

  it('regenerateManifest defaults to empty tags when area has none', async () => {
    await withTempBrain(async (brainPath) => {
      createArea(brainPath, 'untagged', 'Untagged', 'No tags here');
      regenerateManifest(brainPath);

      const manifest = readManifest(brainPath);
      const untagged = manifest!.areas.find((a) => a.id === 'untagged');
      expect(untagged?.tags).toEqual([]);
    });
  });

  it('readManifest defaults missing tags field to [] (backward compat)', async () => {
    await withTempBrain(async (brainPath) => {
      // Hand-write a manifest in the old (pre-tags) format. Existing
      // brains in the wild have manifests without the tags field; the
      // reader must not blow up on them.
      const manifestPath = path.join(brainPath, 'manifest.json');
      fs.writeFileSync(
        manifestPath,
        JSON.stringify(
          {
            version: 1,
            areas: [{ id: 'legacy', summary: 'Legacy', owner: '', updated: '2026-01-01' }],
          },
          null,
          2,
        ),
      );

      const manifest = readManifest(brainPath);
      expect(manifest).not.toBeNull();
      const legacy = manifest!.areas.find((a) => a.id === 'legacy');
      expect(legacy?.tags).toEqual([]);
    });
  });
});
