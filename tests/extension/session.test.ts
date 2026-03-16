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
