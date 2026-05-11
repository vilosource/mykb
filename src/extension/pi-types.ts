// Minimal Pi extension types — real types come from @mariozechner/pi-coding-agent at runtime
export interface ExtensionAPI {
  on(event: string, handler: (...args: unknown[]) => Promise<unknown>): void;
  registerTool(tool: ToolDefinition): void;
  registerCommand(name: string, handler: CommandHandler): void;
  /**
   * Push a `custom`-role message into the session. Pi delivers it to the
   * LLM as user-role text; with no `triggerTurn` it just lands in the
   * conversation for the next turn (the right channel for an extension
   * command to "load this into context now"). Lives on the `pi` object,
   * NOT on the command handler's `ctx` — `ctx` (Pi's
   * `ExtensionCommandContext`) only carries session-control methods.
   */
  sendMessage(
    message: { customType: string; content: string; display?: boolean; details?: unknown },
    options?: { triggerTurn?: boolean; deliverAs?: 'steer' | 'followUp' | 'nextTurn' },
  ): void;
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

/**
 * Matches Pi's `Omit<RegisteredCommand, "name" | "sourceInfo">` (see
 * `@mariozechner/pi-coding-agent`'s `core/extensions/types.d.ts`): the
 * runtime invokes `command.handler(args, ctx)`. NOTE — an earlier
 * version of this stub used `execute` instead of `handler`, which made
 * `/kb` throw "command.handler is not a function" against the real
 * runtime (the L1 test masked it by calling the field directly).
 *
 * `ctx` is Pi's `ExtensionCommandContext` — it carries session-control
 * methods (newSession/fork/navigateTree/...) and a `ui` object, but NOT
 * `sendMessage`/`inject`. To push content at the LLM, capture the `pi`
 * object in a closure and call `pi.sendMessage(...)` (see ExtensionAPI).
 */
export interface CommandHandler {
  description: string;
  handler: (args: string, ctx: unknown) => Promise<void>;
}

export interface BeforeAgentStartResult {
  systemPrompt?: string;
  message?: {
    customType: string;
    content: string;
    display?: boolean;
  };
}
