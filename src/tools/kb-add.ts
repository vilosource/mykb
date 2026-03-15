import type { ExtensionAPI, ToolResult } from '../extension/pi-types.js';
import type { MykbStore } from '../core/knowledge-store.js';
import type { EntryType } from '../core/types.js';
import { ProvenanceStatus } from '../core/types.js';

type KbAddParams = {
  area: string;
  type: string;
  text: string;
  source?: string;
  tags?: string[];
  why?: string;
  rejected?: string;
  failed?: boolean;
  url?: string;
};

export async function executeKbAdd(store: MykbStore, params: KbAddParams): Promise<ToolResult> {
  const { area, type, text } = params;
  const entryType = type as EntryType;
  const tags = params.tags ?? [];
  const provenance = params.source
    ? { status: ProvenanceStatus.Unverified, source: params.source }
    : undefined;
  const baseOptions = { tags, provenance };

  let id: string;

  switch (entryType) {
    case 'fact':
      id = store.addFact(area, text, baseOptions);
      break;
    case 'decision':
      id = store.addDecision(area, text, {
        ...baseOptions,
        why: params.why,
        rejected: params.rejected,
      });
      break;
    case 'gotcha':
      id = store.addGotcha(area, text, {
        ...baseOptions,
        failed: params.failed,
      });
      break;
    case 'pattern':
      id = store.addPattern(area, text, baseOptions);
      break;
    case 'link':
      id = store.addLink(area, text, params.url ?? '', baseOptions);
      break;
    default:
      return {
        content: [{ type: 'text', text: `Unknown entry type: ${type}` }],
        details: {},
      };
  }

  const entries = store.loadArea(area);
  const count = entries.length;

  return {
    content: [
      {
        type: 'text',
        text: `Added ${entryType} to **${area}** (id: ${id}). Area now has ${count} entries.`,
      },
    ],
    details: { id, area, entryType, count },
  };
}

export function registerKbAdd(pi: ExtensionAPI, store: MykbStore): void {
  pi.registerTool({
    name: 'kb_add',
    label: 'Add Knowledge',
    description:
      'Add a knowledge entry (fact, decision, gotcha, pattern, or link) to a knowledge area. Use this whenever you learn something worth remembering.',
    parameters: {
      type: 'object',
      properties: {
        area: { type: 'string', description: 'Knowledge area ID' },
        type: {
          type: 'string',
          enum: ['fact', 'decision', 'gotcha', 'pattern', 'link'],
          description: 'Entry type',
        },
        text: { type: 'string', description: 'The knowledge text' },
        source: {
          type: 'string',
          description: 'Source of the knowledge (optional)',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags for categorization (optional)',
        },
        why: {
          type: 'string',
          description: 'Rationale for decisions (optional)',
        },
        rejected: {
          type: 'string',
          description: 'Rejected alternatives for decisions (optional)',
        },
        failed: {
          type: 'boolean',
          description: 'Whether the gotcha caused a failure (optional)',
        },
        url: {
          type: 'string',
          description: 'URL for links (required for link type)',
        },
      },
      required: ['area', 'type', 'text'],
    },
    execute: async (_toolCallId: string, params: Record<string, unknown>): Promise<ToolResult> => {
      return executeKbAdd(store, params as unknown as KbAddParams);
    },
  });
}
