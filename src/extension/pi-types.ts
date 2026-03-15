// Minimal Pi extension types — real types come from @mariozechner/pi-coding-agent at runtime
export interface ExtensionAPI {
  on(event: string, handler: (...args: unknown[]) => Promise<unknown>): void;
  registerTool(tool: ToolDefinition): void;
  registerCommand(name: string, handler: CommandHandler): void;
}

export interface ToolDefinition {
  name: string;
  label: string;
  description: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
  parameters: unknown;
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
    onUpdate?: unknown,
    ctx?: unknown,
  ) => Promise<ToolResult>;
  renderCall?: unknown;
  renderResult?: unknown;
}

export interface ToolResult {
  content: Array<{ type: string; text: string }>;
  details: Record<string, unknown>;
}

export interface CommandHandler {
  description: string;
  execute: (args: string, ctx: unknown) => Promise<void>;
}
