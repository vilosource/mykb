import type { ExtensionAPI } from '../extension/pi-types.js';
import type { MykbStore } from '../core/knowledge-store.js';
import { registerKbAdd } from './kb-add.js';
import { registerKbSearch } from './kb-search.js';
import { registerKbLoad } from './kb-load.js';
import { registerKbList } from './kb-list.js';
import { registerKbVerify } from './kb-verify.js';

export function registerTools(pi: ExtensionAPI, store: MykbStore, brainPath: string): void {
  registerKbAdd(pi, store);
  registerKbSearch(pi, store);
  registerKbLoad(pi, store);
  registerKbList(pi, store, brainPath);
  registerKbVerify(pi, store);
}
