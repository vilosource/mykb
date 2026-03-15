import { describe, it, expect } from 'vitest';
import { withTempBrain } from '../helpers.js';
import { MykbStore } from '../../src/core/knowledge-store.js';
import { initBrain } from '../../src/core/init.js';
import { executeKbSearch } from '../../src/tools/kb-search.js';

describe('kb_search tool', () => {
  it('returns matching entries as markdown', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);
      const store = MykbStore.open(brainPath);

      store.addFact('docker', 'Docker uses cgroups for isolation');
      store.addFact('docker', 'Docker images are layered');

      const result = await executeKbSearch(store, { query: 'cgroups' });

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain('cgroups');

      store.close();
    });
  });

  it('returns empty message when no matches', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);
      const store = MykbStore.open(brainPath);

      const result = await executeKbSearch(store, { query: 'nonexistent' });

      expect(result.content).toHaveLength(1);
      expect(result.content[0].text).toContain('No matches');

      store.close();
    });
  });
});
