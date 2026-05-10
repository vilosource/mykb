import type { ExtensionAPI } from './pi-types.js';
import { resolveBrainPath, brainExists } from '../core/config.js';
import { initBrain } from '../core/init.js';
import { MykbStore } from '../core/knowledge-store.js';
import { FileSystemWorkspaceStorage } from '../core/workspace.js';
import { SessionState } from './state.js';
import { registerSessionHooks } from './hooks/session.js';
import { registerTools } from '../tools/index.js';
import { createContextHandler } from './hooks/context.js';
import {
  createToolCallHandler,
  createToolResultHandler,
  createInputHandler,
} from './hooks/signals.js';
import { createToolGatingHandler } from './hooks/tool-gating.js';
import { createKbCommandHandler } from './hooks/kb-command.js';

export default function (pi: ExtensionAPI): void {
  const brainPath = resolveBrainPath();

  // Auto-init if needed
  if (!brainExists(brainPath)) {
    initBrain(brainPath);
  }

  const store = MykbStore.open(brainPath);
  const state = new SessionState();
  const wsStorage = new FileSystemWorkspaceStorage(brainPath);

  // Session lifecycle hooks (includes Tier 1 — before_agent_start area index)
  registerSessionHooks(pi, store, state, brainPath, wsStorage);

  // Tier 2 — Context injection on each turn
  pi.on('context', createContextHandler(store, state, brainPath));

  // Tool gating — block direct edits to knowledge files
  const gatingHandler = createToolGatingHandler(brainPath);
  const signalHandler = createToolCallHandler(state);
  pi.on('tool_call', async (event: unknown, ctx: unknown): Promise<unknown> => {
    const e = event as { toolName: string; input: Record<string, unknown> };
    // Run gating first — if blocked, return the block result
    const gatingResult = await gatingHandler({
      toolName: e.toolName,
      input: e.input,
    });
    if (gatingResult) return gatingResult;
    // Otherwise, collect signals
    return signalHandler(event, ctx);
  });

  // Signal collection hooks
  pi.on('tool_result', createToolResultHandler(state));
  pi.on('input', createInputHandler(state));

  // Tier 3 — /kb command for on-demand area loading
  pi.registerCommand('kb', createKbCommandHandler(store, state));

  // Register tools (with workspace storage for workspace tools).
  //
  // MYKB_DISABLE_TOOLS=1 is honored by the kb-spike harness's scoring-
  // isolation scenarios: it suppresses tool registration so the LLM
  // cannot fall back to kb_search/kb_list/kb_load — proving the scorer/
  // system-prompt path delivers area knowledge on its own. See
  // experiments/area-scoring/scenarios/scoring-without-tools.sh.
  if (process.env.MYKB_DISABLE_TOOLS !== '1') {
    registerTools(pi, store, brainPath, wsStorage);
  }
}
