import type { MykbStore } from '../../core/knowledge-store.js';
import type { SessionState } from '../state.js';
import type { AreaMetadata, JournalEntry, WorkspaceStorage } from '../../core/types.js';
import { readManifest } from '../../core/manifest.js';
import { renderContextBlock, renderJournalContextBlock } from '../../core/render.js';
import {
  scoreAreas,
  selectEntriesForInjection,
  KeywordSignalProvider,
  FilePathSignalProvider,
} from '../scorer.js';
import { listAreas } from '../../core/area.js';
import { FileSystemWorkspaceStorage } from '../../core/workspace.js';

type Message = { role: string; content: string };

const DEFAULT_TOKEN_BUDGET = 2000;
const JOURNAL_INJECT_DAYS = 2;
const JOURNAL_INJECT_MAX_ENTRIES = 20;

const providers = [new KeywordSignalProvider(), new FilePathSignalProvider()];

function recentJournalEntries(
  wsStorage: WorkspaceStorage,
  days: number,
  maxEntries: number,
): { workspaceId: string; entries: JournalEntry[] } | null {
  const workspaceId = wsStorage.getActiveWorkspaceId();
  if (!workspaceId) return null;

  const all = wsStorage.readJournal(workspaceId, maxEntries);
  if (all.length === 0) return null;

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const recent = all.filter((e) => e.date >= cutoff);
  if (recent.length === 0) return null;

  return { workspaceId, entries: recent };
}

/**
 * Create a context handler that injects relevant knowledge on each turn.
 * Subscribes to Pi's `context` event.
 */
export function createContextHandler(
  store: MykbStore,
  state: SessionState,
  brainPath: string,
  wsStorage: WorkspaceStorage = new FileSystemWorkspaceStorage(brainPath),
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

    // Select entries within token budget (may be empty if no area matches)
    const selected =
      scored.size > 0
        ? selectEntriesForInjection(scored, store, DEFAULT_TOKEN_BUDGET, state.loadedAreas)
        : new Map();

    // Mark injected areas as loaded
    for (const area of selected.keys()) {
      state.markAreaLoaded(area);
    }

    // Render journal block (if active workspace has recent entries) and context block.
    // Journal precedes context per journal-auto-inject-DESIGN.md.
    const journal = recentJournalEntries(
      wsStorage,
      JOURNAL_INJECT_DAYS,
      JOURNAL_INJECT_MAX_ENTRIES,
    );
    const journalBlock = journal
      ? renderJournalContextBlock(journal.entries, journal.workspaceId, JOURNAL_INJECT_DAYS)
      : '';
    const contextBlock = selected.size > 0 ? renderContextBlock(selected) : '';

    // Nothing to inject → return unchanged
    if (!journalBlock && !contextBlock) {
      state.clearSignals();
      state.turnCount++;
      return messages;
    }

    const systemMessage: Message = {
      role: 'system',
      content: journalBlock + contextBlock,
    };

    // Clear signals and increment turn
    state.clearSignals();
    state.turnCount++;

    return [systemMessage, ...messages];
  };
}
