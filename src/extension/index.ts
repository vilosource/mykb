import type { ExtensionAPI } from './pi-types.js';
import { resolveBrainPath, brainExists } from '../core/config.js';
import { initBrain } from '../core/init.js';
import { MykbStore } from '../core/knowledge-store.js';
import { SessionState } from './state.js';
import { registerSessionHooks } from './hooks/session.js';
import { registerTools } from '../tools/index.js';

export default function (pi: ExtensionAPI): void {
  const brainPath = resolveBrainPath();

  // Auto-init if needed
  if (!brainExists(brainPath)) {
    initBrain(brainPath);
  }

  const store = MykbStore.open(brainPath);
  const state = new SessionState();

  registerSessionHooks(pi, store, state, brainPath);
  registerTools(pi, store, brainPath);
  // registerCommands — placeholder for Phase 8
}
