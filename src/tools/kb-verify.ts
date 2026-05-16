import type { ExtensionAPI, ToolResult } from '../extension/pi-types.js';
import type { KnowledgeStore as MykbStore } from '../core/types.js';

type KbVerifyParams = {
  area: string;
  id: string;
};

export async function executeKbVerify(
  store: MykbStore,
  params: KbVerifyParams,
): Promise<ToolResult> {
  try {
    store.verifyEntry(params.area, params.id);
    return {
      content: [
        {
          type: 'text',
          text: `Entry ${params.id} in area "${params.area}" marked as verified.`,
        },
      ],
      details: { area: params.area, id: params.id },
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      content: [
        {
          type: 'text',
          text: `Error: Entry "${params.id}" not found in area "${params.area}".`,
        },
      ],
      details: { error: message },
    };
  }
}

export function registerKbVerify(pi: ExtensionAPI, store: MykbStore): void {
  pi.registerTool({
    name: 'kb_verify',
    label: 'Verify Entry',
    description:
      'Mark a knowledge entry as verified. Use after confirming a fact is still accurate.',
    parameters: {
      type: 'object',
      properties: {
        area: { type: 'string', description: 'Knowledge area ID' },
        id: { type: 'string', description: 'Entry ID to verify' },
      },
      required: ['area', 'id'],
    },
    execute: async (_toolCallId: string, params: Record<string, unknown>): Promise<ToolResult> => {
      return executeKbVerify(store, params as unknown as KbVerifyParams);
    },
  });
}
