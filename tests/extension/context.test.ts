import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { withTempBrain } from '../helpers.js';
import { initBrain } from '../../src/core/init.js';
import { MykbStore } from '../../src/core/knowledge-store.js';
import { SessionState } from '../../src/extension/state.js';
import { createContextHandler } from '../../src/extension/hooks/context.js';
import { FileSystemWorkspaceStorage } from '../../src/core/workspace.js';
import type { JournalEntry } from '../../src/core/types.js';

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

  it('injects recent journal block when active workspace has entries within the window', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);

      makeAreaDir(brainPath, 'mykb', 'mykb development', ['mykb']);
      makeManifest(brainPath, [{ id: 'mykb', summary: 'mykb development' }]);

      const wsStorage = new FileSystemWorkspaceStorage(brainPath);
      wsStorage.createWorkspace('mykb', 'mykb');
      wsStorage.setActiveWorkspaceId('mykb');

      // Write journal entries directly with controlled dates: yesterday + today
      const today = new Date().toISOString();
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const journalFile = path.join(brainPath, 'workspaces', 'mykb', 'journal.jsonl');
      const entries: JournalEntry[] = [
        { date: yesterday, text: 'wrote design docs' },
        { date: today, text: 'started journal-auto-inject' },
      ];
      fs.writeFileSync(journalFile, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');

      const store = MykbStore.open(brainPath);
      try {
        store.addFact('mykb', 'mykb is a knowledge base CLI', { tags: ['mykb'] });

        const state = new SessionState();
        state.addSignal('keyword', 'mykb development');

        const handler = createContextHandler(store, state, brainPath);
        const result = (await handler([{ role: 'user', content: 'test' }])) as Array<{
          role: string;
          content: string;
        }>;

        const injected = result.find((m) => m.role === 'system');
        expect(injected).toBeDefined();
        expect(injected!.content).toContain('<mykb-journal');
        expect(injected!.content).toContain('workspace="mykb"');
        expect(injected!.content).toContain('wrote design docs');
        expect(injected!.content).toContain('started journal-auto-inject');
        // Journal block appears before context block
        const jIdx = injected!.content.indexOf('<mykb-journal');
        const cIdx = injected!.content.indexOf('<mykb-context');
        expect(jIdx).toBeGreaterThanOrEqual(0);
        expect(cIdx).toBeGreaterThan(jIdx);
      } finally {
        store.close();
      }
    });
  });

  it('does not inject journal block when there is no active workspace', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);
      makeAreaDir(brainPath, 'mykb', 'mykb development', ['mykb']);
      makeManifest(brainPath, [{ id: 'mykb', summary: 'mykb development' }]);

      const store = MykbStore.open(brainPath);
      try {
        const state = new SessionState();
        state.addSignal('keyword', 'mykb development');

        const handler = createContextHandler(store, state, brainPath);
        const result = (await handler([{ role: 'user', content: 'test' }])) as Array<{
          role: string;
          content: string;
        }>;

        const injected = result.find((m) => m.role === 'system');
        // Context may still inject; journal must not
        if (injected) {
          expect(injected.content).not.toContain('<mykb-journal');
        }
      } finally {
        store.close();
      }
    });
  });

  it('skips journal entries older than the window', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);
      makeAreaDir(brainPath, 'mykb', 'mykb development', ['mykb']);
      makeManifest(brainPath, [{ id: 'mykb', summary: 'mykb development' }]);

      const wsStorage = new FileSystemWorkspaceStorage(brainPath);
      wsStorage.createWorkspace('mykb', 'mykb');
      wsStorage.setActiveWorkspaceId('mykb');

      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
      const journalFile = path.join(brainPath, 'workspaces', 'mykb', 'journal.jsonl');
      const entries: JournalEntry[] = [{ date: tenDaysAgo, text: 'ancient milestone' }];
      fs.writeFileSync(journalFile, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');

      const store = MykbStore.open(brainPath);
      try {
        const state = new SessionState();
        state.addSignal('keyword', 'mykb development');

        const handler = createContextHandler(store, state, brainPath);
        const result = (await handler([{ role: 'user', content: 'test' }])) as Array<{
          role: string;
          content: string;
        }>;

        const injected = result.find((m) => m.role === 'system');
        if (injected) {
          expect(injected.content).not.toContain('ancient milestone');
          expect(injected.content).not.toContain('<mykb-journal');
        }
      } finally {
        store.close();
      }
    });
  });

  it('caps injected journal entries at the maximum (20)', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);
      makeAreaDir(brainPath, 'mykb', 'mykb development', ['mykb']);
      makeManifest(brainPath, [{ id: 'mykb', summary: 'mykb development' }]);

      const wsStorage = new FileSystemWorkspaceStorage(brainPath);
      wsStorage.createWorkspace('mykb', 'mykb');
      wsStorage.setActiveWorkspaceId('mykb');

      // 30 entries all dated today — cap should keep the last 20 (newest by file order)
      const now = Date.now();
      const journalFile = path.join(brainPath, 'workspaces', 'mykb', 'journal.jsonl');
      const entries: JournalEntry[] = [];
      for (let i = 0; i < 30; i++) {
        entries.push({
          date: new Date(now - (29 - i) * 60 * 1000).toISOString(),
          text: `entry-${i}`,
        });
      }
      fs.writeFileSync(journalFile, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');

      const store = MykbStore.open(brainPath);
      try {
        const state = new SessionState();
        state.addSignal('keyword', 'mykb development');

        const handler = createContextHandler(store, state, brainPath);
        const result = (await handler([{ role: 'user', content: 'test' }])) as Array<{
          role: string;
          content: string;
        }>;

        const injected = result.find((m) => m.role === 'system');
        expect(injected).toBeDefined();
        expect(injected!.content).toContain('<mykb-journal');
        // Newest 20 included; oldest 10 dropped
        expect(injected!.content).toContain('entry-29');
        expect(injected!.content).toContain('entry-10');
        expect(injected!.content).not.toContain('entry-9');
        expect(injected!.content).not.toContain('entry-0');
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
