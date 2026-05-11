import { describe, it, expect } from 'vitest';
import { withTempBrain } from '../helpers.js';
import { initBrain } from '../../src/core/init.js';
import { MykbStore } from '../../src/core/knowledge-store.js';
import { SessionState } from '../../src/extension/state.js';
import { createKbCommandHandler } from '../../src/extension/hooks/kb-command.js';

/**
 * The handler matches Pi's command shape: `{ description, handler }`.
 * It pushes content via `pi.sendMessage(...)` — the `pi` object, NOT
 * the command `ctx` (Pi's `ExtensionCommandContext` carries no
 * message-injection method; see `src/extension/pi-types.ts`). The mock
 * `pi` below records `sendMessage` calls; the command `ctx` arg is
 * unused so we pass `{}`. (Earlier this test called `handler.execute(...)`
 * with a `ctx.inject` mock, which masked two real-runtime bugs —
 * "command.handler is not a function" and "ctx.sendMessage is not a
 * function".)
 */
type SentMessage = { customType: string; content: string; display?: boolean };

function makePi(): { sent: SentMessage[]; sendMessage: (m: SentMessage) => void } {
  const sent: SentMessage[] = [];
  return { sent, sendMessage: (m: SentMessage) => sent.push(m) };
}

describe('/kb command handler', () => {
  it('parses area IDs and loads area entries', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);
      const store = MykbStore.open(brainPath);
      try {
        store.addFact('networking', 'VPN uses WireGuard', { tags: ['vpn'] });
        store.addFact('networking', 'DNS via Azure', { tags: ['dns'] });

        const state = new SessionState();
        const pi = makePi();
        const handler = createKbCommandHandler(store, state, pi);

        await handler.handler('networking', {});

        expect(pi.sent).toHaveLength(1);
        expect(pi.sent[0].customType).toBe('mykb-loaded-areas');
        expect(pi.sent[0].content).toContain('VPN uses WireGuard');
        expect(pi.sent[0].content).toContain('DNS via Azure');
        expect(pi.sent[0].content).toContain('<mykb-loaded-areas>');
        expect(state.isAreaLoaded('networking')).toBe(true);
      } finally {
        store.close();
      }
    });
  });

  it('handles multiple area IDs', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);
      const store = MykbStore.open(brainPath);
      try {
        store.addFact('networking', 'Network fact');
        store.addFact('secrets', 'Secret fact');

        const state = new SessionState();
        const pi = makePi();
        const handler = createKbCommandHandler(store, state, pi);

        await handler.handler('networking secrets', {});

        expect(pi.sent).toHaveLength(1);
        expect(pi.sent[0].content).toContain('Network fact');
        expect(pi.sent[0].content).toContain('Secret fact');
        expect(state.isAreaLoaded('networking')).toBe(true);
        expect(state.isAreaLoaded('secrets')).toBe(true);
      } finally {
        store.close();
      }
    });
  });

  it('reports when an area has no entries (and does not mark it loaded)', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);
      const store = MykbStore.open(brainPath);
      try {
        const state = new SessionState();
        const pi = makePi();
        const handler = createKbCommandHandler(store, state, pi);

        await handler.handler('nonexistent', {});

        expect(pi.sent).toHaveLength(1);
        expect(pi.sent[0].content).toContain('No entries found for: nonexistent');
        expect(state.isAreaLoaded('nonexistent')).toBe(false);
      } finally {
        store.close();
      }
    });
  });

  it('sends a usage message on empty args', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);
      const store = MykbStore.open(brainPath);
      try {
        const state = new SessionState();
        const pi = makePi();
        const handler = createKbCommandHandler(store, state, pi);

        await handler.handler('   ', {});

        expect(pi.sent).toHaveLength(1);
        expect(pi.sent[0].content).toContain('Usage: /kb');
      } finally {
        store.close();
      }
    });
  });

  it('has correct description', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);
      const store = MykbStore.open(brainPath);
      try {
        const state = new SessionState();
        const handler = createKbCommandHandler(store, state, makePi());
        expect(handler.description).toContain('Load knowledge areas');
      } finally {
        store.close();
      }
    });
  });
});
