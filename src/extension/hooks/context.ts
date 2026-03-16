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

const DEFAULT_TOKEN_BUDGET = 2000;

const providers = [new KeywordSignalProvider(), new FilePathSignalProvider()];

/**
 * Create a context handler that injects relevant knowledge on each turn.
 * Subscribes to Pi's `context` event.
 */
export function createContextHandler(
  store: MykbStore,
  state: SessionState,
  brainPath: string,
): (...args: unknown[]) => Promise<unknown> {
  return async (...args: unknown[]): Promise<unknown> => {
    const messages = args[0] as Message[];
    // No signals → no injection
    if (state.signals.length === 0) {
      return messages;
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
        tags: [],
        created: '',
        updated: a.updated,
      }));
    } else {
      areas = listAreas(brainPath);
    }

    if (areas.length === 0) {
      state.clearSignals();
      state.turnCount++;
      return messages;
    }

    // Score areas based on accumulated signals (with workspace boost)
    const scored = scoreAreas(state.signals, providers, areas, store, state.getBoostedAreas());

    if (scored.size === 0) {
      state.clearSignals();
      state.turnCount++;
      return messages;
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
      state.turnCount++;
      return messages;
    }

    // Mark injected areas as loaded
    for (const area of selected.keys()) {
      state.markAreaLoaded(area);
    }

    // Render context block
    const contextBlock = renderContextBlock(selected);

    // Inject as system message at the beginning
    const systemMessage: Message = {
      role: 'system',
      content: contextBlock,
    };

    // Clear signals and increment turn
    state.clearSignals();
    state.turnCount++;

    return [systemMessage, ...messages];
  };
}
