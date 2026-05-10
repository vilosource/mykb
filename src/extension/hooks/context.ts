import type { MykbStore } from '../../core/knowledge-store.js';
import type { SessionState } from '../state.js';
import type { AreaMetadata } from '../../core/types.js';
import { readManifest } from '../../core/manifest.js';
import { renderContextBlock } from '../../core/render.js';
import {
  scoreAreas,
  selectEntriesForInjection,
  KeywordSignalProvider,
  FilePathSignalProvider,
} from '../scorer.js';
import { listAreas } from '../../core/area.js';

type Message = { role: string; content: string };

/**
 * Pi's `context` event contract.
 * - Receives: { type: 'context', messages: AgentMessage[] }
 * - Returns:  { messages?: AgentMessage[] }   (ContextEventResult)
 *
 * If the handler returns `{ messages }`, Pi replaces the conversation
 * messages for this turn with the returned array. Returning a bare
 * Message[] (or `undefined`) leaves the conversation unchanged — the
 * handler's "injection" is silently discarded. Verified against
 * @mariozechner/pi-coding-agent's types.d.ts.
 */
type ContextEvent = { type: 'context'; messages: Message[] };
type ContextEventResult = { messages?: Message[] };

const DEFAULT_TOKEN_BUDGET = 2000;

const providers = [new KeywordSignalProvider(), new FilePathSignalProvider()];

/**
 * Create a context handler that injects relevant knowledge on each turn.
 * Subscribes to Pi's `context` event.
 *
 * Historical bug — fixed 2026-05-10: this handler was previously
 * reading `args[0]` as `Message[]` directly and returning a bare
 * `Message[]`. Pi's actual contract is to receive a ContextEvent
 * object (with a `messages` field) and to return a ContextEventResult
 * (with an optional `messages` field). The bare-array return was
 * silently ignored, so the per-turn `<mykb-context>` injection
 * never reached the LLM. Visible only when a scenario asserts on a
 * marker FACT (entry text) rather than the area-id (which comes from
 * the always-correct `<mykb-areas>` block in before_agent_start).
 * Surfaced by experiments/area-scoring/scenarios/scoring-isolated.sh.
 */
export function createContextHandler(
  store: MykbStore,
  state: SessionState,
  brainPath: string,
): (...args: unknown[]) => Promise<ContextEventResult | undefined> {
  return async (...args: unknown[]): Promise<ContextEventResult | undefined> => {
    const event = args[0] as ContextEvent;
    const messages = event?.messages ?? [];

    // No signals → no injection. Returning undefined leaves messages
    // unchanged — Pi treats it as a no-op handler.
    if (state.signals.length === 0) {
      return undefined;
    }

    // Load area metadata
    const manifest = readManifest(brainPath);
    let areas: AreaMetadata[];
    if (manifest && manifest.areas.length > 0) {
      areas = manifest.areas.map((a) => ({
        id: a.id,
        name: a.id,
        summary: a.summary,
        owner: a.owner,
        tags: a.tags,
        created: '',
        updated: a.updated,
      }));
    } else {
      areas = listAreas(brainPath);
    }

    if (areas.length === 0) {
      state.clearSignals();
      state.bumpTurnCount();
      return undefined;
    }

    // Score areas based on accumulated signals (with workspace boost)
    const scored = scoreAreas(state.signals, providers, areas, store, state.getBoostedAreas());

    if (scored.size === 0) {
      state.clearSignals();
      state.bumpTurnCount();
      return undefined;
    }

    // Select entries within token budget
    const selected = selectEntriesForInjection(
      scored,
      store,
      DEFAULT_TOKEN_BUDGET,
      state.loadedAreas,
    );

    if (selected.size === 0) {
      state.clearSignals();
      state.bumpTurnCount();
      return undefined;
    }

    // Mark injected areas as loaded
    for (const area of selected.keys()) {
      state.markAreaLoaded(area);
    }

    // Render context block
    const contextBlock = renderContextBlock(selected);

    // Inject via Pi's `custom` role. Pi's convertToLlm() (in
    // pi-agent-core) only knows these roles: user, assistant, toolResult,
    // bashExecution, custom, branchSummary, compactionSummary. A
    // `role: 'system'` message falls through the switch's default
    // case and is filtered out — so the bare-system-message approach
    // never reached the LLM. `custom` messages are converted to a
    // user-role text message, which is the intended channel for
    // extension-injected content. The <mykb-context> tags inside the
    // text help the LLM identify the block as authoritative context.
    const customMessage: Message = {
      role: 'custom',
      content: contextBlock,
    };

    // Clear signals and increment turn
    state.clearSignals();
    state.bumpTurnCount();

    return { messages: [customMessage, ...messages] };
  };
}
