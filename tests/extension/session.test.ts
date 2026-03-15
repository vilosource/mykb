import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { withTempBrain } from '../helpers.js';
import { MykbStore } from '../../src/core/knowledge-store.js';
import { initBrain } from '../../src/core/init.js';
import { SessionState } from '../../src/extension/state.js';
import { registerSessionHooks } from '../../src/extension/hooks/session.js';
import type { ExtensionAPI } from '../../src/extension/pi-types.js';

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
});
