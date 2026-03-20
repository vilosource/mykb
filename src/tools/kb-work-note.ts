import type { ExtensionAPI, ToolResult } from '../extension/pi-types.js';
import type { WorkspaceStorage } from '../core/types.js';

type KbWorkNoteParams = {
  text: string;
  tags?: string[];
};

export async function executeKbWorkNote(
  wsStorage: WorkspaceStorage,
  params: KbWorkNoteParams,
): Promise<ToolResult> {
  const activeId = wsStorage.getActiveWorkspaceId();
  if (!activeId) {
    return {
      content: [{ type: 'text', text: 'No active workspace. Use `kb work activate <id>` first.' }],
      details: {},
    };
  }

  const noteId = wsStorage.appendNote(activeId, params.text, params.tags);
  const tagStr = params.tags?.length ? ` [${params.tags.join(', ')}]` : '';

  return {
    content: [
      {
        type: 'text',
        text: `Added note to workspace **${activeId}**${tagStr} (${noteId}).`,
      },
    ],
    details: { workspaceId: activeId, noteId },
  };
}

export function registerKbWorkNote(pi: ExtensionAPI, wsStorage: WorkspaceStorage): void {
  pi.registerTool({
    name: 'kb_work_note',
    label: 'Add Workspace Note',
    description:
      'Add a tagged note to the active workspace for later triage (e.g. bugs, ideas, questions)',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Note text' },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags for categorization (e.g. bug, idea, question)',
        },
      },
      required: ['text'],
    },
    execute: async (_toolCallId: string, params: Record<string, unknown>): Promise<ToolResult> => {
      return executeKbWorkNote(wsStorage, params as unknown as KbWorkNoteParams);
    },
  });
}
