import type { CommandHandler } from '../pi-types.js';
import type { MykbStore } from '../../core/knowledge-store.js';
import type { SessionState } from '../state.js';
import { type KnowledgeEntry, Zone } from '../../core/types.js';
import { renderMarkdown } from '../../core/render.js';

type KbContext = {
  inject: (content: string) => void;
};

/**
 * Creates the /kb command handler for loading full areas on demand (Tier 3).
 */
export function createKbCommandHandler(store: MykbStore, state: SessionState): CommandHandler {
  return {
    description: 'Load knowledge areas into context. Usage: /kb <area> [area2...]',
    execute: async (args: string, ctx: unknown): Promise<void> => {
      const kbCtx = ctx as KbContext;
      const areaIds = args
        .trim()
        .split(/\s+/)
        .filter((id) => id.length > 0);

      if (areaIds.length === 0) {
        kbCtx.inject('Usage: /kb <area> [area2...]\nSpecify one or more area IDs to load.');
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
        parts.push(renderMarkdown(allEntries));
      }

      if (emptyAreas.length > 0) {
        parts.push(`No entries found for: ${emptyAreas.join(', ')}`);
      }

      kbCtx.inject(parts.join('\n'));
    },
  };
}
