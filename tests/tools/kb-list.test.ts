import { describe, it, expect } from 'vitest';
import { withTempBrain } from '../helpers.js';
import { MykbStore } from '../../src/core/knowledge-store.js';
import { initBrain } from '../../src/core/init.js';
import { createArea } from '../../src/core/area.js';
import { executeKbList } from '../../src/tools/kb-list.js';

describe('kb_list tool', () => {
  it('returns area summaries', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);
      createArea(brainPath, 'docker', 'Docker', 'Container knowledge');
      createArea(brainPath, 'k8s', 'Kubernetes', 'Orchestration knowledge');
      const store = MykbStore.open(brainPath);

      const result = await executeKbList(store, brainPath);

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain('docker');
      expect(result.content[0].text).toContain('k8s');
      expect(result.content[0].text).toContain('Container knowledge');

      store.close();
    });
  });

  it('returns empty message when no areas', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);
      const store = MykbStore.open(brainPath);

      const result = await executeKbList(store, brainPath);

      expect(result.content).toHaveLength(1);
      expect(result.content[0].text).toContain('No areas');

      store.close();
    });
  });
});
