import type { ExtensionAPI, ToolResult } from '../extension/pi-types.js';
import type { KnowledgeStore as MykbStore } from '../core/types.js';
import { listAreas } from '../core/area.js';
import { renderAreaIndex } from '../core/render.js';

export async function executeKbList(_store: MykbStore, brainPath: string): Promise<ToolResult> {
  const areas = listAreas(brainPath);

  if (areas.length === 0) {
    return {
      content: [{ type: 'text', text: 'No areas found in knowledge base.' }],
      details: { count: 0 },
    };
  }

  const markdown = renderAreaIndex(areas);

  return {
    content: [{ type: 'text', text: markdown }],
    details: { count: areas.length },
  };
}

export function registerKbList(pi: ExtensionAPI, store: MykbStore, brainPath: string): void {
  pi.registerTool({
    name: 'kb_list',
    label: 'List Areas',
    description:
      'List all knowledge areas with their summaries. Use to discover what knowledge domains exist.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    execute: async (): Promise<ToolResult> => {
      return executeKbList(store, brainPath);
    },
  });
}
