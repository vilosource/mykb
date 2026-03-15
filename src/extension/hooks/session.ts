import type { ExtensionAPI } from '../pi-types.js';
import type { MykbStore } from '../../core/knowledge-store.js';
import type { SessionState } from '../state.js';
import { initBrain } from '../../core/init.js';
import { isDirtyShutdown, recoverDirtyShutdown } from '../../core/init.js';
import { save } from '../../core/save.js';
import { brainExists } from '../../core/config.js';

export function registerSessionHooks(
  pi: ExtensionAPI,
  _store: MykbStore,
  _state: SessionState,
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

  pi.on('session_shutdown', async () => {
    save(brainPath);
  });
}
