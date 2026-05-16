/**
 * Store selection — `docs/v2-protocol-contract-DESIGN.md` §2.4 + §Dev-mode.
 *
 * Resolves which `KnowledgeStore` implementation a client should use:
 *
 *  - `MYKB_STORE=local` → force the local `MykbStore` (bypass-by-design,
 *    trusted operator / tests — parent DESIGN §Dev-mode).
 *  - `MYKB_STORE=rpc`   → force `RpcKnowledgeStore` (default socket path).
 *  - otherwise auto-detect: if the daemon socket is present, use it
 *    (§2.4 "daemon socket present → use it"); else local.
 *
 * Socket path = `MYKB_SOCKET` if set, else `<brainPath>/.mykbd.sock`
 * (mirrors `daemon/main.ts`). Selection is a startup-time decision; the
 * chosen `mode` is returned so the caller can log it.
 *
 * Both implementations satisfy the same `KnowledgeStore` interface (LSP),
 * so the swap is invisible to extension hooks and CLI subcommands — the
 * payoff of the sync-bridge decision.
 */

import * as path from 'node:path';
import * as fs from 'node:fs';
import { MykbStore } from '../core/knowledge-store.js';
import type { KnowledgeStore } from '../core/types.js';
import { RpcKnowledgeStore } from './rpc-store.js';

export type StoreMode = 'local' | 'rpc';

export interface SelectedStore {
  store: KnowledgeStore;
  mode: StoreMode;
  socketPath?: string;
  /**
   * Release the underlying resource (local DB handle / RPC worker).
   * `close()` is a lifecycle concern, deliberately NOT on the
   * `KnowledgeStore` domain interface — the selection wrapper owns it so
   * callers stay interface-pure.
   */
  close(): void;
}

function socketPathFor(brainPath: string): string {
  return process.env.MYKB_SOCKET ?? path.join(brainPath, '.mykbd.sock');
}

export function selectKnowledgeStore(brainPath: string): SelectedStore {
  const forced = process.env.MYKB_STORE;
  const sock = socketPathFor(brainPath);

  const useRpc = forced === 'rpc' || (forced !== 'local' && fs.existsSync(sock));

  if (useRpc) {
    const store = new RpcKnowledgeStore(sock);
    return { store, mode: 'rpc', socketPath: sock, close: () => store.close() };
  }
  const store = MykbStore.open(brainPath);
  return { store, mode: 'local', close: () => store.close() };
}
