import type { CommandHandler, ExtensionAPI } from '../pi-types.js';
import type { MykbStore } from '../../core/knowledge-store.js';
import type { SessionState } from '../state.js';
import { type KnowledgeEntry, Zone } from '../../core/types.js';
import { renderMarkdown } from '../../core/render.js';

/** customType for the message `/kb` pushes into the session. */
const KB_LOADED_AREAS_TYPE = 'mykb-loaded-areas';

/**
 * Creates the /kb command handler for loading full areas on demand (Tier 3).
 *
 * Registered via `pi.registerCommand('kb', createKbCommandHandler(store, state, pi))`.
 * Pi invokes `command.handler(args, ctx)`; the handler pushes the loaded
 * entries into the session via `pi.sendMessage({ customType, content })`
 * — a `custom`-role message that Pi delivers to the LLM as user-role
 * text on the next turn. It does NOT trigger an LLM turn by itself.
 * Loaded areas are also marked in SessionState so the sticky-area boost
 * picks them up on subsequent turns.
 *
 * (History: this handler previously returned `{ description, execute }`
 * and called `ctx.inject(...)`. Both were wrong against the real Pi
 * runtime — it expects `handler`, the command `ctx` has no `inject`/
 * `sendMessage` (only `pi` does) — so `/kb` threw "command.handler is
 * not a function" and had never worked outside the L1 test. See
 * docs/findings-log.md.)
 */
export function createKbCommandHandler(
  store: MykbStore,
  state: SessionState,
  pi: Pick<ExtensionAPI, 'sendMessage'>,
): CommandHandler {
  const send = (content: string): void => {
    pi.sendMessage({ customType: KB_LOADED_AREAS_TYPE, content, display: true });
  };

  return {
    description: 'Load knowledge areas into context. Usage: /kb <area> [area2...]',
    handler: async (args: string, _ctx: unknown): Promise<void> => {
      const areaIds = args
        .trim()
        .split(/\s+/)
        .filter((id) => id.length > 0);

      if (areaIds.length === 0) {
        send('Usage: /kb <area> [area2...]\nSpecify one or more area IDs to load.');
        return;
      }

      const allEntries: KnowledgeEntry[] = [];
      const emptyAreas: string[] = [];

      for (const areaId of areaIds) {
        const entries = store.loadArea(areaId, { excludeZone: Zone.Archive });
        if (entries.length === 0) {
          emptyAreas.push(areaId);
        } else {
          allEntries.push(...entries);
          state.markAreaLoaded(areaId);
        }
      }

      const parts: string[] = [];

      if (allEntries.length > 0) {
        parts.push(`<mykb-loaded-areas>\n${renderMarkdown(allEntries)}</mykb-loaded-areas>`);
      }

      if (emptyAreas.length > 0) {
        parts.push(`No entries found for: ${emptyAreas.join(', ')}`);
      }

      send(parts.join('\n'));
    },
  };
}
