import type { ExtensionAPI, ToolResult } from '../extension/pi-types.js';
import type { WorkspaceStorage } from '../core/types.js';

type KbWorkJournalParams = {
  text: string;
};

export async function executeKbWorkJournal(
  wsStorage: WorkspaceStorage,
  params: KbWorkJournalParams,
): Promise<ToolResult> {
  const activeId = wsStorage.getActiveWorkspaceId();
  if (!activeId) {
    return {
      content: [{ type: 'text', text: 'No active workspace. Use `kb work activate <id>` first.' }],
      details: {},
    };
  }

  wsStorage.appendJournal(activeId, params.text);

  return {
    content: [
      {
        type: 'text',
        text: `Added journal entry to workspace **${activeId}**.`,
      },
    ],
    details: { workspaceId: activeId },
  };
}

export function registerKbWorkJournal(pi: ExtensionAPI, wsStorage: WorkspaceStorage): void {
  pi.registerTool({
    name: 'kb_work_journal',
    label: 'Add Journal Entry',
    description: "Add a journal entry to the active workspace's progress log",
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Journal entry text' },
      },
      required: ['text'],
    },
    execute: async (_toolCallId: string, params: Record<string, unknown>): Promise<ToolResult> => {
      return executeKbWorkJournal(wsStorage, params as unknown as KbWorkJournalParams);
    },
  });
}
