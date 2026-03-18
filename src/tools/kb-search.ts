import type { ExtensionAPI, ToolResult } from '../extension/pi-types.js';
import type { MykbStore } from '../core/knowledge-store.js';
import { Zone } from '../core/types.js';
import { renderMarkdown } from '../core/render.js';

type KbSearchParams = {
  query: string;
};

export async function executeKbSearch(
  store: MykbStore,
  params: KbSearchParams,
): Promise<ToolResult> {
  const entries = store.search(params.query, Zone.Archive);

  if (entries.length === 0) {
    return {
      content: [{ type: 'text', text: `No matches for "${params.query}".` }],
      details: { count: 0 },
    };
  }

  const markdown = renderMarkdown(entries);

  return {
    content: [{ type: 'text', text: markdown }],
    details: { count: entries.length },
  };
}

export function registerKbSearch(pi: ExtensionAPI, store: MykbStore): void {
  pi.registerTool({
    name: 'kb_search',
    label: 'Search Knowledge',
    description:
      'Search the knowledge base for relevant facts, decisions, and gotchas using keywords.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query (keywords or phrase)',
        },
      },
      required: ['query'],
    },
    execute: async (_toolCallId: string, params: Record<string, unknown>): Promise<ToolResult> => {
      return executeKbSearch(store, params as unknown as KbSearchParams);
    },
  });
}
