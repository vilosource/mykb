import type { ExtensionAPI } from '../pi-types.js';
import type { BeforeAgentStartResult } from '../pi-types.js';
import type { KnowledgeStore as MykbStore } from '../../core/types.js';
import type { SessionState } from '../state.js';
import { initBrain } from '../../core/init.js';
import { isDirtyShutdown, recoverDirtyShutdown } from '../../core/init.js';
import { save } from '../../core/save.js';
import { brainExists } from '../../core/config.js';
import { readManifest } from '../../core/manifest.js';
import { renderAreaIndex, renderWorkspace } from '../../core/render.js';
import type { AreaMetadata, WorkspaceStorage } from '../../core/types.js';
import { filterRecentJournal, cutoffForDays } from '../../core/journal-window.js';

const JOURNAL_INJECT_DAYS = 2;
const JOURNAL_INJECT_MAX_ENTRIES = 20;

export function createBeforeAgentStartHandler(
  _store: MykbStore,
  state: SessionState,
  brainPath: string,
  wsStorage?: WorkspaceStorage,
): (event: unknown, ctx: unknown) => Promise<BeforeAgentStartResult> {
  return async (event: unknown, _ctx: unknown): Promise<BeforeAgentStartResult> => {
    // Pi passes the current system prompt in the event — we must APPEND, not replace
    const e = event as { systemPrompt?: string; prompt?: string };
    const currentPrompt = e.systemPrompt || '';

    const manifest = readManifest(brainPath);

    let areaBlock: string;
    if (!manifest || manifest.areas.length === 0) {
      areaBlock = '<mykb-areas>\nNo knowledge areas available.\n</mykb-areas>';
    } else {
      const areas: AreaMetadata[] = manifest.areas.map((a) => ({
        id: a.id,
        name: a.id,
        summary: a.summary,
        owner: a.owner,
        tags: a.tags,
        created: '',
        updated: a.updated,
      }));

      const index = renderAreaIndex(areas);
      areaBlock = `<mykb-areas>\n${index}</mykb-areas>`;
    }

    let workspaceBlock = '';
    if (wsStorage) {
      const activeId = wsStorage.getActiveWorkspaceId();
      if (activeId) {
        const workspace = wsStorage.readWorkspace(activeId);
        if (workspace) {
          // Pull the newest N entries from disk, then keep only those within
          // the recency window. The N cap guards against pathological journals;
          // the date filter is the actual policy (per docs/journal-auto-inject-DESIGN.md).
          const allRecent = wsStorage.readJournal(activeId, JOURNAL_INJECT_MAX_ENTRIES);
          const journalEntries = filterRecentJournal(
            allRecent,
            cutoffForDays(JOURNAL_INJECT_DAYS),
            JOURNAL_INJECT_MAX_ENTRIES,
          );
          const handoff = wsStorage.readHandoff(activeId);
          const rendered = renderWorkspace(workspace, journalEntries, undefined, handoff);
          workspaceBlock = `\n\n<mykb-workspace>\n${rendered}</mykb-workspace>\n`;
          state.setBoostedAreas(workspace.areas);
        }
      }
    }

    return {
      systemPrompt: currentPrompt + '\n\n' + areaBlock + '\n' + workspaceBlock,
    };
  };
}

export function registerSessionHooks(
  pi: ExtensionAPI,
  store: MykbStore,
  state: SessionState,
  brainPath: string,
  wsStorage?: WorkspaceStorage,
): void {
  pi.on('session_start', async () => {
    // Auto-init brain if missing
    if (!brainExists(brainPath)) {
      initBrain(brainPath);
    }

    // Recover from dirty shutdown
    if (isDirtyShutdown(brainPath)) {
      recoverDirtyShutdown(brainPath);
    }
  });

  pi.on('before_agent_start', createBeforeAgentStartHandler(store, state, brainPath, wsStorage));

  pi.on('session_shutdown', async () => {
    save(brainPath);

    if (wsStorage) {
      const activeId = wsStorage.getActiveWorkspaceId();
      if (activeId) {
        wsStorage.updateWorkspaceState(activeId, {});
      }
    }
  });
}
