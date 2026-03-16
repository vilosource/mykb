import type { ExtensionAPI, ToolResult } from '../extension/pi-types.js';
import type { WorkspaceStorage, WorkspaceState } from '../core/types.js';

type KbWorkStateParams = {
  phase?: string;
  active?: string;
  blocked?: string;
  next?: string;
};

export async function executeKbWorkState(
  wsStorage: WorkspaceStorage,
  params: KbWorkStateParams,
): Promise<ToolResult> {
  const activeId = wsStorage.getActiveWorkspaceId();
  if (!activeId) {
    return {
      content: [{ type: 'text', text: 'No active workspace. Use `kb work activate <id>` first.' }],
      details: {},
    };
  }

  const stateUpdate: Partial<WorkspaceState> = {};
  const updatedFields: string[] = [];

  if (params.phase !== undefined) {
    stateUpdate.phase = params.phase;
    updatedFields.push('phase');
  }
  if (params.active !== undefined) {
    stateUpdate.active = params.active;
    updatedFields.push('active');
  }
  if (params.blocked !== undefined) {
    stateUpdate.blocked = params.blocked;
    updatedFields.push('blocked');
  }
  if (params.next !== undefined) {
    stateUpdate.next = params.next;
    updatedFields.push('next');
  }

  wsStorage.updateWorkspaceState(activeId, stateUpdate);

  return {
    content: [
      {
        type: 'text',
        text: `Updated workspace **${activeId}** state: ${updatedFields.join(', ')}.`,
      },
    ],
    details: { workspaceId: activeId, updatedFields },
  };
}

export function registerKbWorkState(pi: ExtensionAPI, wsStorage: WorkspaceStorage): void {
  pi.registerTool({
    name: 'kb_work_state',
    label: 'Update Workspace State',
    description:
      'Update the active workspace\'s state (phase, active task, blocked, next step)',
    parameters: {
      type: 'object',
      properties: {
        phase: { type: 'string', description: 'Current work phase' },
        active: { type: 'string', description: 'Currently active task' },
        blocked: { type: 'string', description: 'What is blocking progress' },
        next: { type: 'string', description: 'Next step to take' },
      },
    },
    execute: async (_toolCallId: string, params: Record<string, unknown>): Promise<ToolResult> => {
      return executeKbWorkState(wsStorage, params as unknown as KbWorkStateParams);
    },
  });
}
