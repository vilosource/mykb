import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { withTempBrain } from '../helpers.js';
import { MykbStore } from '../../src/core/knowledge-store.js';
import { initBrain } from '../../src/core/init.js';
import { SessionState } from '../../src/extension/state.js';
import { registerSessionHooks } from '../../src/extension/hooks/session.js';
import { FileSystemWorkspaceStorage } from '../../src/core/workspace.js';
import type { ExtensionAPI } from '../../src/extension/pi-types.js';
import type { BeforeAgentStartResult } from '../../src/extension/pi-types.js';

function createMockPi(): ExtensionAPI & {
  handlers: Map<string, (...args: unknown[]) => Promise<unknown>>;
} {
  const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
  return {
    handlers,
    on(event: string, handler: (...args: unknown[]) => Promise<unknown>): void {
      handlers.set(event, handler);
    },
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
  };
}

describe('registerSessionHooks', () => {
  it('registers session_start and session_shutdown handlers', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);
      const store = MykbStore.open(brainPath);
      const state = new SessionState();
      const pi = createMockPi();

      registerSessionHooks(pi, store, state, brainPath);

      expect(pi.handlers.has('session_start')).toBe(true);
      expect(pi.handlers.has('session_shutdown')).toBe(true);

      store.close();
    });
  });

  it('session_start handles fresh brain without error', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);
      const store = MykbStore.open(brainPath);
      const state = new SessionState();
      const pi = createMockPi();

      registerSessionHooks(pi, store, state, brainPath);

      const startHandler = pi.handlers.get('session_start')!;
      await expect(startHandler()).resolves.not.toThrow();

      store.close();
    });
  });

  it('session_shutdown saves without error', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);
      const store = MykbStore.open(brainPath);
      const state = new SessionState();
      const pi = createMockPi();

      registerSessionHooks(pi, store, state, brainPath);

      // Add some data so there's something to save
      store.addFact('test-area', 'some fact');

      const shutdownHandler = pi.handlers.get('session_shutdown')!;
      await expect(shutdownHandler()).resolves.not.toThrow();

      store.close();
    });
  });

  it('session_start recovers dirty shutdown', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);

      // Create uncommitted file to simulate dirty shutdown
      // Use a non-JSONL file so hydration doesn't choke on invalid data
      fs.writeFileSync(path.join(brainPath, 'uncommitted-note.txt'), 'dirty data\n');

      const store = MykbStore.open(brainPath);
      const state = new SessionState();
      const pi = createMockPi();

      registerSessionHooks(pi, store, state, brainPath);

      const startHandler = pi.handlers.get('session_start')!;
      await expect(startHandler()).resolves.not.toThrow();

      store.close();
    });
  });

  it('before_agent_start with active workspace injects workspace context', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);
      const store = MykbStore.open(brainPath);
      const state = new SessionState();
      const pi = createMockPi();

      const wsStorage = new FileSystemWorkspaceStorage(brainPath);
      wsStorage.createWorkspace('test-ws', 'Test Workspace', { areas: ['networking'] });
      wsStorage.setActiveWorkspaceId('test-ws');
      wsStorage.appendJournal('test-ws', 'Previous session: configured DNS');

      registerSessionHooks(pi, store, state, brainPath, wsStorage);

      const handler = pi.handlers.get('before_agent_start')!;
      const result = (await handler({ systemPrompt: 'base prompt' }, {})) as BeforeAgentStartResult;

      expect(result.systemPrompt).toContain('<mykb-workspace>');
      expect(result.systemPrompt).toContain('Test Workspace');
      expect(result.systemPrompt).toContain('configured DNS');
      expect(result.systemPrompt).toContain('</mykb-workspace>');

      // boostedAreas should be set
      expect(state.getBoostedAreas().has('networking')).toBe(true);

      store.close();
    });
  });

  // The data blocks (<mykb-areas>/<mykb-workspace>) tell the LLM nothing about
  // when to consult the brain — without an operating-instructions block the
  // model answers "what did we work on" by running ls/find. This anchors that
  // the <mykb-protocol> block is present and names the key entry points.
  it('before_agent_start injects the operating-protocol block', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);
      const store = MykbStore.open(brainPath);
      const state = new SessionState();
      const pi = createMockPi();
      const wsStorage = new FileSystemWorkspaceStorage(brainPath);

      registerSessionHooks(pi, store, state, brainPath, wsStorage);

      const handler = pi.handlers.get('before_agent_start')!;
      const result = (await handler({ systemPrompt: 'base prompt' }, {})) as BeforeAgentStartResult;

      expect(result.systemPrompt).toContain('<mykb-protocol>');
      expect(result.systemPrompt).toContain('</mykb-protocol>');
      // Names the cold-start digest and forbids the filesystem fallback.
      expect(result.systemPrompt).toContain('kb recent');
      expect(result.systemPrompt).toMatch(/do not.*\bls\b.*\bfind\b/i);
      // Comes before the data blocks it refers to.
      expect(result.systemPrompt.indexOf('<mykb-protocol>')).toBeLessThan(
        result.systemPrompt.indexOf('<mykb-areas>'),
      );

      store.close();
    });
  });

  it('before_agent_start without active workspace does not inject workspace context', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);
      const store = MykbStore.open(brainPath);
      const state = new SessionState();
      const pi = createMockPi();

      const wsStorage = new FileSystemWorkspaceStorage(brainPath);
      // No active workspace set

      registerSessionHooks(pi, store, state, brainPath, wsStorage);

      const handler = pi.handlers.get('before_agent_start')!;
      const result = (await handler({ systemPrompt: 'base prompt' }, {})) as BeforeAgentStartResult;

      expect(result.systemPrompt).not.toContain('<mykb-workspace>');
      expect(state.getBoostedAreas().size).toBe(0);

      store.close();
    });
  });

  // Regression for the bug surfaced by experiments/area-scoring/scenarios/
  // kb-list-shows-tags.sh: session.ts:39 hardcoded `tags: []` when
  // building AreaMetadata from manifest, so the area index in the
  // system prompt never showed tags even after the manifest schema
  // was extended. The fix is `tags: a.tags`. Without this Layer-1
  // anchor, the L4 scenario was the only thing detecting it — a
  // future refactor could re-introduce the bug silently.
  it('before_agent_start renders area-index tags from manifest', async () => {
    const { createArea } = await import('../../src/core/area.js');
    const { regenerateManifest } = await import('../../src/core/manifest.js');

    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);
      createArea(brainPath, 'widgets', 'Widgets', 'Widget knowledge', ['blue', 'calibration']);
      regenerateManifest(brainPath);

      const store = MykbStore.open(brainPath);
      const state = new SessionState();
      const pi = createMockPi();
      const wsStorage = new FileSystemWorkspaceStorage(brainPath);

      registerSessionHooks(pi, store, state, brainPath, wsStorage);

      const handler = pi.handlers.get('before_agent_start')!;
      const result = (await handler({ systemPrompt: 'base' }, {})) as BeforeAgentStartResult;

      // The <mykb-areas> block must show the tags suffix appended by
      // renderAreaIndex; that only happens if session.ts threads
      // a.tags into AreaMetadata (not hardcoded []).
      expect(result.systemPrompt).toContain('[tags: blue, calibration]');

      store.close();
    });
  });

  it('session_shutdown with active workspace updates timestamp', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);
      const store = MykbStore.open(brainPath);
      const state = new SessionState();
      const pi = createMockPi();

      const wsStorage = new FileSystemWorkspaceStorage(brainPath);
      wsStorage.createWorkspace('test-ws', 'Test Workspace');
      wsStorage.setActiveWorkspaceId('test-ws');

      const wsBefore = wsStorage.readWorkspace('test-ws')!;
      const updatedBefore = wsBefore.updated;

      // Small delay so timestamp differs
      await new Promise((r) => setTimeout(r, 10));

      registerSessionHooks(pi, store, state, brainPath, wsStorage);

      const shutdownHandler = pi.handlers.get('session_shutdown')!;
      await shutdownHandler();

      const wsAfter = wsStorage.readWorkspace('test-ws')!;
      expect(wsAfter.updated).not.toBe(updatedBefore);

      store.close();
    });
  });
});
