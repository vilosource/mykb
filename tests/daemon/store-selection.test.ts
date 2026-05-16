import { describe, it, expect, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { withTempBrain } from '../helpers.js';
import { initBrain } from '../../src/core/init.js';
import { MykbStore } from '../../src/core/knowledge-store.js';
import { RpcKnowledgeStore } from '../../src/daemon/rpc-store.js';
import { selectKnowledgeStore } from '../../src/daemon/store-selection.js';

// Phase 4 — store selection (contract §2.4 "daemon socket present → use
// it"; §Dev-mode env override MYKB_STORE=rpc|local). The extension picks
// RpcKnowledgeStore when the daemon socket is bind-mounted in, else the
// local MykbStore — both behind the same KnowledgeStore interface.

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe('selectKnowledgeStore', () => {
  it('returns the local MykbStore when no daemon socket is present', async () => {
    await withTempBrain(async (bp) => {
      initBrain(bp);
      delete process.env.MYKB_SOCKET;
      delete process.env.MYKB_STORE;
      const { store, mode } = selectKnowledgeStore(bp);
      try {
        expect(mode).toBe('local');
        expect(store).toBeInstanceOf(MykbStore);
      } finally {
        (store as MykbStore).close?.();
      }
    });
  });

  it('returns RpcKnowledgeStore when a daemon socket file is present', async () => {
    await withTempBrain(async (bp) => {
      initBrain(bp);
      const sock = path.join(bp, '.mykbd.sock');
      fs.writeFileSync(sock, ''); // presence is the signal (§2.4)
      delete process.env.MYKB_STORE;
      const { store, mode } = selectKnowledgeStore(bp);
      try {
        expect(mode).toBe('rpc');
        expect(store).toBeInstanceOf(RpcKnowledgeStore);
      } finally {
        (store as RpcKnowledgeStore).close();
      }
    });
  });

  it('honours MYKB_SOCKET as the explicit socket path', async () => {
    await withTempBrain(async (bp) => {
      initBrain(bp);
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sel-'));
      const sock = path.join(dir, 'custom.sock');
      fs.writeFileSync(sock, '');
      process.env.MYKB_SOCKET = sock;
      delete process.env.MYKB_STORE;
      const { store, mode } = selectKnowledgeStore(bp);
      try {
        expect(mode).toBe('rpc');
        expect(store).toBeInstanceOf(RpcKnowledgeStore);
      } finally {
        (store as RpcKnowledgeStore).close();
      }
    });
  });

  it('MYKB_STORE=local forces local even if a socket is present', async () => {
    await withTempBrain(async (bp) => {
      initBrain(bp);
      fs.writeFileSync(path.join(bp, '.mykbd.sock'), '');
      process.env.MYKB_STORE = 'local';
      const { store, mode } = selectKnowledgeStore(bp);
      try {
        expect(mode).toBe('local');
        expect(store).toBeInstanceOf(MykbStore);
      } finally {
        (store as MykbStore).close?.();
      }
    });
  });

  it('MYKB_STORE=rpc forces rpc using the default socket path', async () => {
    await withTempBrain(async (bp) => {
      initBrain(bp);
      process.env.MYKB_STORE = 'rpc';
      delete process.env.MYKB_SOCKET;
      const { store, mode } = selectKnowledgeStore(bp);
      try {
        expect(mode).toBe('rpc');
        expect(store).toBeInstanceOf(RpcKnowledgeStore);
      } finally {
        (store as RpcKnowledgeStore).close();
      }
    });
  });
});
