import type { ExtensionAPI } from '../extension/pi-types.js';
import type { MykbStore } from '../core/knowledge-store.js';
import type { WorkspaceStorage } from '../core/types.js';
import { registerKbAdd } from './kb-add.js';
import { registerKbSearch } from './kb-search.js';
import { registerKbLoad } from './kb-load.js';
import { registerKbList } from './kb-list.js';
import { registerKbVerify } from './kb-verify.js';
import { registerKbWorkState } from './kb-work-state.js';
import { registerKbWorkJournal } from './kb-work-journal.js';

export function registerTools(
  pi: ExtensionAPI,
  store: MykbStore,
  brainPath: string,
  wsStorage?: WorkspaceStorage,
): void {
  registerKbAdd(pi, store);
  registerKbSearch(pi, store);
  registerKbLoad(pi, store);
  registerKbList(pi, store, brainPath);
  registerKbVerify(pi, store);

  if (wsStorage) {
    registerKbWorkState(pi, wsStorage);
    registerKbWorkJournal(pi, wsStorage);
  }
}
