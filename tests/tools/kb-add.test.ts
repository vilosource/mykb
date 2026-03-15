import { describe, it, expect } from 'vitest';
import { withTempBrain } from '../helpers.js';
import { MykbStore } from '../../src/core/knowledge-store.js';
import { initBrain } from '../../src/core/init.js';
import { executeKbAdd } from '../../src/tools/kb-add.js';

describe('kb_add tool', () => {
  it('adds a fact and returns confirmation', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);
      const store = MykbStore.open(brainPath);

      const result = await executeKbAdd(store, {
        area: 'docker',
        type: 'fact',
        text: 'Docker uses cgroups for isolation',
      });

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain('docker');
      expect(result.content[0].text).toContain('fact');

      const entries = store.loadArea('docker');
      expect(entries).toHaveLength(1);
      expect(entries[0].text).toBe('Docker uses cgroups for isolation');
      expect(entries[0].type).toBe('fact');

      store.close();
    });
  });

  it('adds a decision with why and rejected', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);
      const store = MykbStore.open(brainPath);

      const result = await executeKbAdd(store, {
        area: 'infra',
        type: 'decision',
        text: 'Use Terraform over Pulumi',
        why: 'Better community support',
        rejected: 'Pulumi',
      });

      expect(result.content[0].text).toContain('decision');

      const entries = store.loadArea('infra');
      expect(entries).toHaveLength(1);
      expect(entries[0].type).toBe('decision');

      store.close();
    });
  });

  it('adds a gotcha with failed flag', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);
      const store = MykbStore.open(brainPath);

      const result = await executeKbAdd(store, {
        area: 'k8s',
        type: 'gotcha',
        text: 'Pod DNS takes 30s to propagate',
        failed: true,
      });

      expect(result.content[0].text).toContain('gotcha');

      store.close();
    });
  });

  it('adds a pattern', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);
      const store = MykbStore.open(brainPath);

      const result = await executeKbAdd(store, {
        area: 'typescript',
        type: 'pattern',
        text: 'Use discriminated unions for state',
      });

      expect(result.content[0].text).toContain('pattern');

      store.close();
    });
  });

  it('adds a link with url', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);
      const store = MykbStore.open(brainPath);

      const result = await executeKbAdd(store, {
        area: 'docs',
        type: 'link',
        text: 'TypeScript handbook',
        url: 'https://typescriptlang.org/docs',
      });

      expect(result.content[0].text).toContain('link');

      store.close();
    });
  });

  it('adds with tags', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);
      const store = MykbStore.open(brainPath);

      await executeKbAdd(store, {
        area: 'docker',
        type: 'fact',
        text: 'Use multi-stage builds',
        tags: ['optimization', 'best-practice'],
      });

      const entries = store.loadArea('docker');
      expect(entries[0].tags).toContain('optimization');
      expect(entries[0].tags).toContain('best-practice');

      store.close();
    });
  });

  it('adds with source provenance', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);
      const store = MykbStore.open(brainPath);

      await executeKbAdd(store, {
        area: 'docker',
        type: 'fact',
        text: 'Default bridge network has no DNS',
        source: 'docker docs',
      });

      const entries = store.loadArea('docker');
      expect(entries[0].provenance.source).toBe('docker docs');

      store.close();
    });
  });
});
