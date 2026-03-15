import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { withTempBrain } from '../helpers.js';
import { initBrain } from '../../src/core/init.js';
import { MykbStore } from '../../src/core/knowledge-store.js';
import { SessionState } from '../../src/extension/state.js';
import { createBeforeAgentStartHandler } from '../../src/extension/hooks/session.js';

describe('Tier 1 — before_agent_start handler', () => {
  it('reads manifest and returns system prompt with area index', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);

      // Create area data so manifest can be generated
      const areaDir = path.join(brainPath, 'networking');
      fs.mkdirSync(areaDir, { recursive: true });
      fs.writeFileSync(
        path.join(areaDir, 'area.json'),
        JSON.stringify({
          id: 'networking',
          name: 'Networking',
          summary: 'Network config, DNS, VPN',
          owner: 'netops',
          tags: ['network'],
          created: '2026-01-01T00:00:00.000Z',
          updated: '2026-03-10T00:00:00.000Z',
        }),
      );

      // Write manifest
      fs.writeFileSync(
        path.join(brainPath, 'manifest.json'),
        JSON.stringify({
          version: 1,
          areas: [
            {
              id: 'networking',
              summary: 'Network config, DNS, VPN',
              owner: 'netops',
              updated: '2026-03-10T00:00:00.000Z',
            },
          ],
        }),
      );

      const store = MykbStore.open(brainPath);
      const state = new SessionState();

      try {
        const handler = createBeforeAgentStartHandler(store, state, brainPath);
        const mockEvent = { systemPrompt: 'existing system prompt' };
        const result = await handler(mockEvent, {});

        expect(result).toBeDefined();
        expect(result.systemPrompt).toBeDefined();
        expect(result.systemPrompt).toContain('existing system prompt');
        expect(result.systemPrompt).toContain('networking');
        expect(result.systemPrompt).toContain('Network config, DNS, VPN');
      } finally {
        store.close();
      }
    });
  });

  it('returns empty system prompt when no manifest exists', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);
      const store = MykbStore.open(brainPath);
      const state = new SessionState();

      try {
        const handler = createBeforeAgentStartHandler(store, state, brainPath);
        const mockEvent = { systemPrompt: '' };
        const result = await handler(mockEvent, {});

        // Should still return a result but with minimal/no area index
        expect(result).toBeDefined();
        expect(result.systemPrompt).toBeDefined();
      } finally {
        store.close();
      }
    });
  });
});
