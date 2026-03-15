import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { withTempBrain } from '../helpers.js';
import {
  createArea,
  readAreaMetadata,
  updateAreaMetadata,
  listAreas,
  areaExists,
  deleteArea,
} from '../../src/core/area.js';
import type { AreaMetadata } from '../../src/core/types.js';

describe('createArea', () => {
  it('should create directory and area.json with correct metadata', async () => {
    await withTempBrain(async (brainPath) => {
      createArea(brainPath, 'networking', 'Networking', 'Network infrastructure knowledge');

      const areaDir = path.join(brainPath, 'areas', 'networking');
      expect(fs.existsSync(areaDir)).toBe(true);

      const areaJsonPath = path.join(areaDir, 'area.json');
      expect(fs.existsSync(areaJsonPath)).toBe(true);

      const metadata = JSON.parse(fs.readFileSync(areaJsonPath, 'utf-8')) as AreaMetadata;
      expect(metadata.id).toBe('networking');
      expect(metadata.name).toBe('Networking');
      expect(metadata.summary).toBe('Network infrastructure knowledge');
      expect(metadata.owner).toBe('');
      expect(metadata.tags).toEqual([]);
      expect(metadata.created).toBeDefined();
      expect(metadata.updated).toBeDefined();
    });
  });
});

describe('readAreaMetadata', () => {
  it('should return AreaMetadata from area.json', async () => {
    await withTempBrain(async (brainPath) => {
      createArea(brainPath, 'networking', 'Networking', 'Network knowledge');

      const metadata = readAreaMetadata(brainPath, 'networking');
      expect(metadata).not.toBeNull();
      expect(metadata!.id).toBe('networking');
      expect(metadata!.name).toBe('Networking');
      expect(metadata!.summary).toBe('Network knowledge');
    });
  });

  it('should return null when area does not exist', async () => {
    await withTempBrain(async (brainPath) => {
      const metadata = readAreaMetadata(brainPath, 'nonexistent');
      expect(metadata).toBeNull();
    });
  });
});

describe('updateAreaMetadata', () => {
  it('should modify area.json fields', async () => {
    await withTempBrain(async (brainPath) => {
      createArea(brainPath, 'networking', 'Networking', 'Old summary');

      updateAreaMetadata(brainPath, 'networking', {
        summary: 'New summary',
        owner: 'team-infra',
        tags: ['infra', 'network'],
      });

      const metadata = readAreaMetadata(brainPath, 'networking');
      expect(metadata!.summary).toBe('New summary');
      expect(metadata!.owner).toBe('team-infra');
      expect(metadata!.tags).toEqual(['infra', 'network']);
      // Name should be unchanged
      expect(metadata!.name).toBe('Networking');
    });
  });
});

describe('listAreas', () => {
  it('should return all area metadata', async () => {
    await withTempBrain(async (brainPath) => {
      createArea(brainPath, 'networking', 'Networking', 'Network knowledge');
      createArea(brainPath, 'ci-pipelines', 'CI Pipelines', 'CI/CD knowledge');

      const areas = listAreas(brainPath);
      expect(areas).toHaveLength(2);

      const ids = areas.map((a) => a.id).sort();
      expect(ids).toEqual(['ci-pipelines', 'networking']);
    });
  });

  it('should return empty array when no areas exist', async () => {
    await withTempBrain(async (brainPath) => {
      const areas = listAreas(brainPath);
      expect(areas).toEqual([]);
    });
  });
});

describe('areaExists', () => {
  it('should return true when area exists', async () => {
    await withTempBrain(async (brainPath) => {
      createArea(brainPath, 'networking', 'Networking', 'Network knowledge');
      expect(areaExists(brainPath, 'networking')).toBe(true);
    });
  });

  it('should return false when area does not exist', async () => {
    await withTempBrain(async (brainPath) => {
      expect(areaExists(brainPath, 'nonexistent')).toBe(false);
    });
  });
});

describe('deleteArea', () => {
  it('should remove directory and all files', async () => {
    await withTempBrain(async (brainPath) => {
      createArea(brainPath, 'networking', 'Networking', 'Network knowledge');

      // Verify it exists first
      expect(areaExists(brainPath, 'networking')).toBe(true);

      deleteArea(brainPath, 'networking');

      expect(areaExists(brainPath, 'networking')).toBe(false);
      const areaDir = path.join(brainPath, 'areas', 'networking');
      expect(fs.existsSync(areaDir)).toBe(false);
    });
  });
});
