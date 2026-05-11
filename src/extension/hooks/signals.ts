import type { SessionState } from '../state.js';

// Pi's extension event bus delivers these shapes (see
// @mariozechner/pi-coding-agent core/extensions/types.d.ts):
//   tool_call   -> { type, toolCallId, toolName, input }
//   tool_result -> { type, toolCallId, input, content: TextContent[], isError, toolName }
//   input       -> { type, text, source }
// Pi names its built-in file tools in lowercase ('read'/'write'/'edit') and
// puts the file path under input.path; we also accept the Claude-style
// `file_path` / `filePath` aliases (matching tool-gating.ts).

type ToolCallEvent = {
  toolName?: string;
  input?: Record<string, unknown>;
};

type TextContentBlock = { type: 'text'; text: string };

type ToolResultEvent = {
  toolName?: string;
  content?: Array<{ type: string; text?: string }>;
};

type InputEvent = {
  text?: string;
};

const FILE_PATH_TOOLS = new Set(['read', 'write', 'edit']);
const MAX_OUTPUT_LENGTH = 500;

/**
 * Creates a handler for tool_call events that extracts file path signals.
 */
export function createToolCallHandler(
  state: SessionState,
): (...args: unknown[]) => Promise<unknown> {
  return async (...args: unknown[]): Promise<unknown> => {
    const event = args[0] as ToolCallEvent;
    if (!FILE_PATH_TOOLS.has((event.toolName ?? '').toLowerCase())) return;

    const input = event.input ?? {};
    const filePath = input.file_path ?? input.path ?? input.filePath;
    if (typeof filePath === 'string' && filePath.length > 0) {
      state.addSignal('file_path', filePath);
    }
  };
}

/**
 * Creates a handler for tool_result events that extracts keyword signals.
 */
export function createToolResultHandler(
  state: SessionState,
): (...args: unknown[]) => Promise<unknown> {
  return async (...args: unknown[]): Promise<unknown> => {
    const event = args[0] as ToolResultEvent;
    const text = (event.content ?? [])
      .filter(
        (block): block is TextContentBlock =>
          block?.type === 'text' && typeof block.text === 'string',
      )
      .map((block) => block.text)
      .join(' ')
      .trim();
    if (text.length === 0) return;

    // Truncate long output to first MAX_OUTPUT_LENGTH chars
    const truncated = text.length > MAX_OUTPUT_LENGTH ? text.slice(0, MAX_OUTPUT_LENGTH) : text;

    state.addSignal('keyword', truncated);
  };
}

/**
 * Creates a handler for input events that adds user text as keyword signal.
 */
export function createInputHandler(state: SessionState): (...args: unknown[]) => Promise<unknown> {
  return async (...args: unknown[]): Promise<unknown> => {
    const event = args[0] as InputEvent;
    if (!event.text || event.text.length === 0) return;
    state.addSignal('keyword', event.text);
  };
}
