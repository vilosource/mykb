import { describe, it, expect } from 'vitest';
import { withTempBrain } from '../helpers.js';
import { MykbStore } from '../../src/core/knowledge-store.js';
import { initBrain } from '../../src/core/init.js';
import { executeKbVerify } from '../../src/tools/kb-verify.js';
import { ProvenanceStatus } from '../../src/core/types.js';

describe('kb_verify tool', () => {
  it('marks an entry as verified', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);
      const store = MykbStore.open(brainPath);

      const id = store.addFact('docker', 'Docker uses cgroups');

      const result = await executeKbVerify(store, {
        area: 'docker',
        id,
      });

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain('verified');

      const entries = store.loadArea('docker');
      expect(entries[0].provenance.status).toBe(ProvenanceStatus.Verified);

      store.close();
    });
  });

  it('returns error for non-existent entry', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);
      const store = MykbStore.open(brainPath);

      const result = await executeKbVerify(store, {
        area: 'docker',
        id: 'nonexist',
      });

      expect(result.content[0].text).toContain('not found');

      store.close();
    });
  });
});
