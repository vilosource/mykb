interface ToolGatingEvent {
  toolName: string;
  input: Record<string, unknown>;
}

interface ToolGatingResult {
  block: boolean;
  reason: string;
}

/**
 * Creates a tool_call handler that blocks direct writes to knowledge files.
 * Forces the AI to use kb_add, kb_update, or kb_verify tools instead.
 */
export function createToolGatingHandler(
  brainPath: string,
): (event: ToolGatingEvent) => Promise<ToolGatingResult | undefined> {
  return async (event: ToolGatingEvent): Promise<ToolGatingResult | undefined> => {
    const isWriteTool = event.toolName === 'write' || event.toolName === 'edit';
    if (!isWriteTool) return;

    const filePath = String(
      event.input?.file_path || event.input?.path || event.input?.filePath || '',
    );

    // Block if file is inside brainPath or matches knowledge file patterns
    if (
      filePath.startsWith(brainPath) ||
      filePath.endsWith('.jsonl') ||
      filePath.endsWith('area.json') ||
      filePath === 'manifest.json'
    ) {
      return {
        block: true,
        reason:
          'Do not edit knowledge files directly. Use the kb_add, kb_update, or kb_verify tools instead to manage knowledge entries.',
      };
    }
  };
}
