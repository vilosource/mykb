import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { initBrain } from '../../src/core/init.js';
import { createArea } from '../../src/core/area.js';
import { MykbStore } from '../../src/core/knowledge-store.js';
import { RpcKnowledgeStore } from '../../src/daemon/rpc-store.js';
import { EntryNotFoundError } from '../../src/core/errors.js';

// Phase 3 — RpcKnowledgeStore is the client-side Adapter behind the
// EXISTING (synchronous) KnowledgeStore interface (decision: sync via a
// worker-thread + Atomics blocking bridge; zero ripple to call sites).
//
// The daemon runs as a SEPARATE PROCESS — both because that is the real
// v2 topology (host daemon, in-container client) and because a
// synchronous client necessarily blocks its own event loop, so an
// in-process daemon sharing that loop would be starved (documented in
// sync-client.ts).
//
// ONE shared daemon + brain for the whole file, tests namespaced by area:
// per-test daemon spawns produced enough process churn to load-flake an
// unrelated concurrency test under vitest's cross-file parallelism. One
// idle daemon is the minimal faithful footprint.

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../../..');
const daemonMain = path.join(repoRoot, 'dist', 'daemon', 'main.js');

let brainPath: string;
let socketPath: string;
let child: ChildProcess;
let store: RpcKnowledgeStore;

beforeAll(async () => {
  if (!fs.existsSync(daemonMain)) {
    execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' });
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mykbd-rpc-'));
  brainPath = path.join(dir, 'brain');
  fs.mkdirSync(brainPath);
  initBrain(brainPath);
  socketPath = path.join(dir, 'd.sock');
  child = spawn(process.execPath, [daemonMain], {
    env: { ...process.env, MYKB_DIR: brainPath, MYKB_SOCKET: socketPath },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('daemon did not start')), 20_000);
    const tick = setInterval(() => {
      if (fs.existsSync(socketPath)) {
        clearInterval(tick);
        clearTimeout(t);
        resolve();
      }
    }, 50);
    child.on('error', reject);
  });
  store = new RpcKnowledgeStore(socketPath);
}, 60_000);

afterAll(() => {
  store?.close();
  child?.kill('SIGTERM');
});

/** Each test gets its own area in the shared brain (isolation). */
function area(name: string): string {
  createArea(brainPath, name, name, `${name} area`);
  return name;
}

describe('RpcKnowledgeStore — synchronous adapter over the wire', () => {
  it('addFact returns an id synchronously and the entry is loadable', () => {
    const a = area('add');
    const id = store.addFact(a, 'cgroups isolate processes');
    expect(typeof id).toBe('string');
    expect(id).toMatch(/\w+/);
    expect(store.loadArea(a).map((e) => e.text)).toContain('cgroups isolate processes');
  });

  it('is behaviourally substitutable with the local MykbStore (LSP)', () => {
    const a = area('lsp');
    store.addFact(a, 'layered images');
    store.addDecision(a, 'use overlayfs', { why: 'fast' } as never);

    const local = MykbStore.open(brainPath);
    try {
      expect(
        store
          .loadArea(a)
          .map((e) => e.text)
          .sort(),
      ).toEqual(
        local
          .loadArea(a)
          .map((e) => e.text)
          .sort(),
      );
      expect(store.search('layered').map((e) => e.id)).toEqual(
        local.search('layered').map((e) => e.id),
      );
      expect(store.matchAreas('layered images')).toEqual(local.matchAreas('layered images'));
    } finally {
      local.close();
    }
  });

  it('reconstructs a typed core error from the wire error envelope', () => {
    const a = area('err');
    expect(() => store.updateEntry(a, 'no-such-id', { text: 'x' })).toThrow(EntryNotFoundError);
  });

  it('lifecycle verbs round-trip (verify/promote/archive/delete)', () => {
    const a = area('life');
    const id = store.addFact(a, 'ephemeral');
    // daemon default capability is operator → verify allowed
    expect(() => store.verifyEntry(a, id)).not.toThrow();
    expect(() => store.promoteEntry(a, id)).not.toThrow();
    store.deleteEntry(a, id);
    expect(store.loadArea(a).find((e) => e.id === id)).toBeUndefined();
  });

  it('survives many sequential blocking calls on one client', () => {
    const a = area('many');
    for (let i = 0; i < 25; i++) store.addFact(a, `fact ${i}`);
    expect(store.loadArea(a)).toHaveLength(25);
  });
});
