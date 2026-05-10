import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { withTempBrain } from '../helpers.js';
import { initBrain } from '../../src/core/init.js';
import { MykbStore } from '../../src/core/knowledge-store.js';
import { SessionState } from '../../src/extension/state.js';
import { createBeforeAgentStartHandler } from '../../src/extension/hooks/session.js';
import { FileSystemWorkspaceStorage } from '../../src/core/workspace.js';

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

  describe('journal injection (last 2 days, max 20)', () => {
    it('includes journal entries within the recency window', async () => {
      await withTempBrain(async (brainPath) => {
        initBrain(brainPath);

        const wsStorage = new FileSystemWorkspaceStorage(brainPath);
        wsStorage.createWorkspace('mykb', 'mykb');
        wsStorage.setActiveWorkspaceId('mykb');

        const today = new Date().toISOString();
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const journalFile = path.join(brainPath, 'workspaces', 'mykb', 'journal.jsonl');
        const entries = [
          { date: yesterday, text: 'wrote design docs' },
          { date: today, text: 'started implementation' },
        ];
        fs.writeFileSync(journalFile, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');

        const store = MykbStore.open(brainPath);
        const state = new SessionState();
        try {
          const handler = createBeforeAgentStartHandler(store, state, brainPath, wsStorage);
          const result = await handler({ systemPrompt: '' }, {});

          expect(result.systemPrompt).toContain('<mykb-workspace>');
          expect(result.systemPrompt).toContain('wrote design docs');
          expect(result.systemPrompt).toContain('started implementation');
        } finally {
          store.close();
        }
      });
    });

    it('excludes journal entries older than the window', async () => {
      await withTempBrain(async (brainPath) => {
        initBrain(brainPath);

        const wsStorage = new FileSystemWorkspaceStorage(brainPath);
        wsStorage.createWorkspace('mykb', 'mykb');
        wsStorage.setActiveWorkspaceId('mykb');

        const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
        const today = new Date().toISOString();
        const journalFile = path.join(brainPath, 'workspaces', 'mykb', 'journal.jsonl');
        const entries = [
          { date: fiveDaysAgo, text: 'ANCIENT_ENTRY' },
          { date: today, text: 'RECENT_ENTRY' },
        ];
        fs.writeFileSync(journalFile, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');

        const store = MykbStore.open(brainPath);
        const state = new SessionState();
        try {
          const handler = createBeforeAgentStartHandler(store, state, brainPath, wsStorage);
          const result = await handler({ systemPrompt: '' }, {});

          expect(result.systemPrompt).toContain('RECENT_ENTRY');
          expect(result.systemPrompt).not.toContain('ANCIENT_ENTRY');
        } finally {
          store.close();
        }
      });
    });

    it('caps injected journal entries at 20 even when many are within the window', async () => {
      await withTempBrain(async (brainPath) => {
        initBrain(brainPath);

        const wsStorage = new FileSystemWorkspaceStorage(brainPath);
        wsStorage.createWorkspace('mykb', 'mykb');
        wsStorage.setActiveWorkspaceId('mykb');

        const now = Date.now();
        const journalFile = path.join(brainPath, 'workspaces', 'mykb', 'journal.jsonl');
        // 30 entries all within the last hour — date filter passes them all,
        // but the max-entries cap should keep only the newest 20.
        const entries: Array<{ date: string; text: string }> = [];
        for (let i = 0; i < 30; i++) {
          entries.push({
            date: new Date(now - (29 - i) * 60 * 1000).toISOString(),
            text: `MARKER_${i}`,
          });
        }
        fs.writeFileSync(journalFile, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');

        const store = MykbStore.open(brainPath);
        const state = new SessionState();
        try {
          const handler = createBeforeAgentStartHandler(store, state, brainPath, wsStorage);
          const result = await handler({ systemPrompt: '' }, {});

          // Newest 20 included
          expect(result.systemPrompt).toContain('MARKER_29');
          expect(result.systemPrompt).toContain('MARKER_10');
          // Oldest 10 dropped
          expect(result.systemPrompt).not.toContain('MARKER_9');
          expect(result.systemPrompt).not.toContain('MARKER_0');
        } finally {
          store.close();
        }
      });
    });

    it('omits the workspace block entirely when no active workspace', async () => {
      await withTempBrain(async (brainPath) => {
        initBrain(brainPath);

        const wsStorage = new FileSystemWorkspaceStorage(brainPath);
        // No workspace created, no active workspace.

        const store = MykbStore.open(brainPath);
        const state = new SessionState();
        try {
          const handler = createBeforeAgentStartHandler(store, state, brainPath, wsStorage);
          const result = await handler({ systemPrompt: '' }, {});

          expect(result.systemPrompt).not.toContain('<mykb-workspace>');
        } finally {
          store.close();
        }
      });
    });
  });
});
