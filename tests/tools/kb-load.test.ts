import { describe, it, expect } from 'vitest';
import { withTempBrain } from '../helpers.js';
import { MykbStore } from '../../src/core/knowledge-store.js';
import { initBrain } from '../../src/core/init.js';
import { executeKbLoad } from '../../src/tools/kb-load.js';

describe('kb_load tool', () => {
  it('returns area entries as markdown', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);
      const store = MykbStore.open(brainPath);

      store.addFact('docker', 'Docker uses cgroups');
      store.addDecision('docker', 'Use Alpine base images');

      const result = await executeKbLoad(store, { area: 'docker' });

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain('docker');
      expect(result.content[0].text).toContain('cgroups');

      store.close();
    });
  });

  it('returns empty message for unknown area', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);
      const store = MykbStore.open(brainPath);

      const result = await executeKbLoad(store, { area: 'nonexistent' });

      expect(result.content).toHaveLength(1);
      expect(result.content[0].text).toContain('No entries');

      store.close();
    });
  });

  it('filters by zone when provided', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);
      const store = MykbStore.open(brainPath);

      const id = store.addFact('docker', 'active fact');
      store.addFact('docker', 'another fact');
      store.promoteEntry('docker', id);

      const result = await executeKbLoad(store, {
        area: 'docker',
        zone: 'established',
      });

      expect(result.content[0].text).toContain('active fact');
      expect(result.content[0].text).not.toContain('another fact');

      store.close();
    });
  });

  it('filters by tag when provided', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);
      const store = MykbStore.open(brainPath);

      store.addFact('docker', 'tagged fact', { tags: ['important'] });
      store.addFact('docker', 'untagged fact');

      const result = await executeKbLoad(store, {
        area: 'docker',
        tag: 'important',
      });

      expect(result.content[0].text).toContain('tagged fact');
      expect(result.content[0].text).not.toContain('untagged fact');

      store.close();
    });
  });
});
