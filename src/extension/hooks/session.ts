import type { ExtensionAPI } from '../pi-types.js';
import type { BeforeAgentStartResult } from '../pi-types.js';
import type { MykbStore } from '../../core/knowledge-store.js';
import type { SessionState } from '../state.js';
import { initBrain } from '../../core/init.js';
import { isDirtyShutdown, recoverDirtyShutdown } from '../../core/init.js';
import { save } from '../../core/save.js';
import { brainExists } from '../../core/config.js';
import { readManifest } from '../../core/manifest.js';
import { renderAreaIndex } from '../../core/render.js';
import type { AreaMetadata } from '../../core/types.js';

export function createBeforeAgentStartHandler(
  _store: MykbStore,
  _state: SessionState,
  brainPath: string,
): () => Promise<BeforeAgentStartResult> {
  return async (): Promise<BeforeAgentStartResult> => {
    const manifest = readManifest(brainPath);

    if (!manifest || manifest.areas.length === 0) {
      return {
        systemPrompt: '<mykb-areas>\nNo knowledge areas available.\n</mykb-areas>\n',
      };
    }

    // Convert ManifestArea to AreaMetadata for rendering
    const areas: AreaMetadata[] = manifest.areas.map((a) => ({
      id: a.id,
      name: a.id,
      summary: a.summary,
      owner: a.owner,
      tags: [],
      created: '',
      updated: a.updated,
    }));

    const index = renderAreaIndex(areas);
    return {
      systemPrompt: `<mykb-areas>\n${index}</mykb-areas>\n`,
    };
  };
}

export function registerSessionHooks(
  pi: ExtensionAPI,
  store: MykbStore,
  state: SessionState,
  brainPath: string,
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

  pi.on('before_agent_start', createBeforeAgentStartHandler(store, state, brainPath));

  pi.on('session_shutdown', async () => {
    save(brainPath);
  });
}
