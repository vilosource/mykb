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
