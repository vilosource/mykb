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

// Helper: build a Pi `context` event payload from a flat messages list.
// The handler expects ContextEvent: { type: 'context', messages: [...] },
// not a bare messages array (a previous bug treated args[0] as the array
// directly — see context.ts comment for history).
type ContextEvent = { type: 'context'; messages: Array<{ role: string; content: string }> };
function ctxEvent(messages: Array<{ role: string; content: string }>): ContextEvent {
  return { type: 'context', messages };
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
        const result = await handler(ctxEvent(messages));

        // ContextEventResult shape: { messages?: ... }. Pi replaces
        // the conversation messages with `result.messages` when set.
        expect(result).toBeDefined();
        expect(result?.messages).toBeDefined();
        const out = result!.messages!;
        expect(out.length).toBeGreaterThan(messages.length);

        const injected = out.find(
          (m) => m.role === 'custom' && m.content.includes('<mykb-context>'),
        );
        expect(injected).toBeDefined();
        expect(injected!.content).toContain('VPN uses WireGuard');
      } finally {
        store.close();
      }
    });
  });

  // Regression for the bug surfaced by experiments/area-scoring/scenarios/
  // scoring-without-tools.sh: context.ts hardcoded `tags: []` when
  // building AreaMetadata from manifest, so the keyword scorer never
  // matched on tag overlap even after the manifest schema was extended.
  // The fix is `tags: a.tags`. Without this Layer-1 anchor, the only
  // detection was the L4 scenario — and the scenario found it only
  // after a long debug. This unit test makes the contract explicit.
  it('builds AreaMetadata with tags from manifest, scoring tag overlap', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);

      // Area with a UNIQUE tag word and a summary that does NOT overlap
      // with the prompt — so scoring can ONLY succeed via tag overlap.
      makeAreaDir(brainPath, 'tagged', 'A simple placeholder description', ['zynnoflux']);
      fs.writeFileSync(
        path.join(brainPath, 'manifest.json'),
        JSON.stringify({
          version: 1,
          areas: [
            {
              id: 'tagged',
              summary: 'A simple placeholder description',
              owner: 'test',
              updated: '2026-03-15T00:00:00.000Z',
              tags: ['zynnoflux'],
            },
          ],
        }),
      );

      const store = MykbStore.open(brainPath);
      try {
        store.addFact('tagged', 'The fact text contains no tag word.');

        const state = new SessionState();
        state.addSignal('keyword', 'zynnoflux');

        const handler = createContextHandler(store, state, brainPath);
        const messages = [{ role: 'user', content: 'about zynnoflux' }];
        const result = await handler(ctxEvent(messages));

        expect(result?.messages).toBeDefined();
        const out = result!.messages!;
        const injected = out.find(
          (m) => m.role === 'custom' && m.content.includes('<mykb-context>'),
        );
        expect(injected).toBeDefined();
        expect(injected!.content).toContain('## tagged');
        expect(injected!.content).toContain('The fact text contains no tag word');
      } finally {
        store.close();
      }
    });
  });

  it('returns undefined when no signals (Pi treats undefined as no-op)', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);
      const store = MykbStore.open(brainPath);
      try {
        const state = new SessionState();
        // No signals added

        const handler = createContextHandler(store, state, brainPath);
        const messages = [{ role: 'user', content: 'Hello' }];
        const result = await handler(ctxEvent(messages));

        // Returning undefined leaves Pi's existing messages unchanged.
        // (Returning the bare array, as the pre-fix handler did, was
        // silently ignored — the contract requires either { messages }
        // or undefined.)
        expect(result).toBeUndefined();
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
        await handler(ctxEvent([{ role: 'user', content: 'test' }]));

        expect(state.signals).toHaveLength(0);
        expect(state.turnCount).toBe(1);
      } finally {
        store.close();
      }
    });
  });

  // Regression for the Pi context-event contract bug fixed 2026-05-10.
  // The handler MUST read args[0].messages (ContextEvent shape) and
  // MUST return { messages } (ContextEventResult shape). The pre-fix
  // version read args[0] directly as a Message[] and returned a bare
  // array — both wrong. Pi silently ignored the "injection" so the
  // marker fact never reached the LLM. Surfaced by experiments/
  // area-scoring/scenarios/scoring-isolated.sh.
  it('reads messages from event.messages, returns { messages } on inject', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);
      makeAreaDir(brainPath, 'tagged', 'placeholder', ['zynnoflux']);
      fs.writeFileSync(
        path.join(brainPath, 'manifest.json'),
        JSON.stringify({
          version: 1,
          areas: [
            {
              id: 'tagged',
              summary: 'placeholder',
              owner: '',
              updated: '2026-03-15T00:00:00.000Z',
              tags: ['zynnoflux'],
            },
          ],
        }),
      );

      const store = MykbStore.open(brainPath);
      try {
        store.addFact('tagged', 'fact body');

        const state = new SessionState();
        state.addSignal('keyword', 'zynnoflux');

        const handler = createContextHandler(store, state, brainPath);

        // Pass the event shape Pi actually emits.
        const event = { type: 'context' as const, messages: [{ role: 'user', content: 'q' }] };
        const result = await handler(event);

        // Result must be a ContextEventResult-shaped object.
        expect(result).toEqual(
          expect.objectContaining({ messages: expect.any(Array) }),
        );
        // Original messages must still be present (we prepend, not replace).
        expect(result!.messages![result!.messages!.length - 1]).toEqual({
          role: 'user',
          content: 'q',
        });
      } finally {
        store.close();
      }
    });
  });
});
