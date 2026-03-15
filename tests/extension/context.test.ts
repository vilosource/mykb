import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { withTempBrain } from '../helpers.js';
import { initBrain } from '../../src/core/init.js';
import { MykbStore } from '../../src/core/knowledge-store.js';
import { SessionState } from '../../src/extension/state.js';
import { createContextHandler } from '../../src/extension/hooks/context.js';

function makeManifest(brainPath: string, areas: Array<{ id: string; summary: string }>): void {
  fs.writeFileSync(
    path.join(brainPath, 'manifest.json'),
    JSON.stringify({
      version: 1,
      areas: areas.map((a) => ({
        id: a.id,
        summary: a.summary,
        owner: 'test',
        updated: '2026-03-15T00:00:00.000Z',
      })),
    }),
  );
}

function makeAreaDir(brainPath: string, id: string, summary: string, tags: string[]): void {
  const areaDir = path.join(brainPath, 'areas', id);
  fs.mkdirSync(areaDir, { recursive: true });
  fs.writeFileSync(
    path.join(areaDir, 'area.json'),
    JSON.stringify({
      id,
      name: id,
      summary,
      owner: 'test',
      tags,
      created: '2026-01-01T00:00:00.000Z',
      updated: '2026-03-15T00:00:00.000Z',
    }),
  );
}

describe('Tier 2 — context handler', () => {
  it('injects matching facts when signals present', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);

      makeAreaDir(brainPath, 'networking', 'Network config, DNS, VPN, firewall', [
        'network',
        'dns',
        'vpn',
      ]);
      makeManifest(brainPath, [
        { id: 'networking', summary: 'Network config, DNS, VPN, firewall' },
      ]);

      const store = MykbStore.open(brainPath);
      try {
        store.addFact('networking', 'VPN uses WireGuard on port 51820', { tags: ['vpn'] });

        const state = new SessionState();
        state.addSignal('keyword', 'VPN firewall network');

        const handler = createContextHandler(store, state, brainPath);
        const messages = [{ role: 'user', content: 'Tell me about VPN' }];
        const result = await handler(messages);

        // Should have injected a system message
        expect(result.length).toBeGreaterThan(messages.length);

        const injected = result.find(
          (m: Record<string, string>) =>
            m.role === 'system' && m.content.includes('<mykb-context>'),
        );
        expect(injected).toBeDefined();
        expect(injected.content).toContain('VPN uses WireGuard');
      } finally {
        store.close();
      }
    });
  });

  it('returns messages unchanged when no signals', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);
      const store = MykbStore.open(brainPath);
      try {
        const state = new SessionState();
        // No signals added

        const handler = createContextHandler(store, state, brainPath);
        const messages = [{ role: 'user', content: 'Hello' }];
        const result = await handler(messages);

        expect(result).toEqual(messages);
      } finally {
        store.close();
      }
    });
  });

  it('clears signals and increments turn count after injection', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);

      makeAreaDir(brainPath, 'secrets', 'Secret management, vault', ['secrets', 'vault']);
      makeManifest(brainPath, [{ id: 'secrets', summary: 'Secret management, vault' }]);

      const store = MykbStore.open(brainPath);
      try {
        store.addFact('secrets', 'Vault uses auto-unseal', { tags: ['vault'] });

        const state = new SessionState();
        state.addSignal('keyword', 'vault secrets');

        const handler = createContextHandler(store, state, brainPath);
        await handler([{ role: 'user', content: 'test' }]);

        expect(state.signals).toHaveLength(0);
        expect(state.turnCount).toBe(1);
      } finally {
        store.close();
      }
    });
  });
});
