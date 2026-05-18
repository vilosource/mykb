import type { ExtensionAPI, ToolResult } from '../extension/pi-types.js';
import type { KnowledgeStore as MykbStore } from '../core/types.js';
import type { EntryFilter } from '../core/types.js';
import { Zone } from '../core/types.js';
import { renderMarkdown } from '../core/render.js';

type KbLoadParams = {
  area: string;
  zone?: string;
  tag?: string;
};

function parseZone(zone: string): Zone | undefined {
  const zoneMap: Record<string, Zone> = {
    active: Zone.Active,
    established: Zone.Established,
    archive: Zone.Archive,
  };
  return zoneMap[zone];
}

export async function executeKbLoad(store: MykbStore, params: KbLoadParams): Promise<ToolResult> {
  const filter: EntryFilter = {};

  if (params.zone) {
    filter.zone = parseZone(params.zone);
  }

  if (params.tag) {
    filter.tags = [params.tag];
  }

  const entries = store.loadArea(params.area, filter);

  if (entries.length === 0) {
    return {
      content: [{ type: 'text', text: `No entries found in area "${params.area}".` }],
      details: { area: params.area, count: 0 },
    };
  }

  const markdown = renderMarkdown(entries);

  return {
    content: [{ type: 'text', text: markdown }],
    details: { area: params.area, count: entries.length },
  };
}

export function registerKbLoad(pi: ExtensionAPI, store: MykbStore): void {
  pi.registerTool({
    name: 'kb_load',
    label: 'Load Area Knowledge',
    description:
      'Load all knowledge for a specific area. Use when you need comprehensive context about a domain.',
    parameters: {
      type: 'object',
      properties: {
        area: { type: 'string', description: 'Knowledge area ID' },
        zone: {
          type: 'string',
          enum: ['incoming', 'active', 'established', 'archive'],
          description: 'Filter by zone (optional)',
        },
        tag: {
          type: 'string',
          description: 'Filter by tag (optional)',
        },
      },
      required: ['area'],
    },
    execute: async (_toolCallId: string, params: Record<string, unknown>): Promise<ToolResult> => {
      return executeKbLoad(store, params as unknown as KbLoadParams);
    },
  });
}
