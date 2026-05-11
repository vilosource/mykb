import type { ExtensionAPI } from '../pi-types.js';
import type { BeforeAgentStartResult } from '../pi-types.js';
import type { MykbStore } from '../../core/knowledge-store.js';
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

// Operating instructions for the LLM — injected once per session ahead of the
// <mykb-areas>/<mykb-workspace> data blocks. The data blocks alone don't tell
// the model what to do with them; without this it answers "what did we work
// on" by running `ls`/`find` instead of consulting the brain. Keep terse — a
// long block gets skimmed. Commands shown are the `kb` CLI (always available
// via the shell); `/kb <area>` is the in-session slash command.
const PROTOCOL_BLOCK = `<mykb-protocol>
You have the mykb knowledge base available. The user's work history, decisions, and project knowledge live in it — it is the source of truth, not the filesystem.

- "what did we work on" / "where did we leave off" / "what's the status of X": read the mykb-workspace block below (active workspace: Resume + recent journal). If it's absent or doesn't cover it, run \`kb recent\` (cross-workspace activity digest) or \`kb work show <id>\`. Do NOT \`ls\`/\`find\` to answer activity questions.
- A question about a specific topic, project, or area: find a matching id in the mykb-areas list below, then load it with the \`/kb <area>\` slash command before answering. Or \`kb search <query>\` for keyword search across all areas, \`kb match "<text>"\` to find the right area.
- The user tells you something durable about a project (a fact, a chosen approach + why, a trap that bit them, a reusable recipe): offer to persist it — \`kb add fact|decision|gotcha|pattern <area> '<text>'\` (single-quote the text — backticks/$() trigger shell substitution).
- Capturing progress: \`kb work journal '<milestone>'\`. Session continuity for next time: \`kb work handoff '<what is in flight and next>'\`. End of session: \`kb save\` (git-commits the brain).
</mykb-protocol>`;

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
      systemPrompt:
        currentPrompt + '\n\n' + PROTOCOL_BLOCK + '\n\n' + areaBlock + '\n' + workspaceBlock,
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
