import type { SessionState } from '../state.js';

type ToolCallEvent = {
  tool: string;
  params: Record<string, unknown>;
};

type ToolResultEvent = {
  tool: string;
  output: string;
};

type InputEvent = {
  text: string;
};

const FILE_PATH_TOOLS = new Set(['Read', 'Write', 'Edit']);
const MAX_OUTPUT_LENGTH = 500;

/**
 * Creates a handler for tool_call events that extracts file path signals.
 */
export function createToolCallHandler(
  state: SessionState,
): (...args: unknown[]) => Promise<unknown> {
  return async (...args: unknown[]): Promise<unknown> => {
    const event = args[0] as ToolCallEvent;
    if (!FILE_PATH_TOOLS.has(event.tool)) return;

    const filePath = event.params.file_path;
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
    if (!event.output || event.output.length === 0) return;

    // Truncate long output to first MAX_OUTPUT_LENGTH chars
    const truncated =
      event.output.length > MAX_OUTPUT_LENGTH
        ? event.output.slice(0, MAX_OUTPUT_LENGTH)
        : event.output;

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
