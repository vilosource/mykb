import { describe, it, expect } from 'vitest';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { withTempBrain } from '../helpers.js';
import { initBrain } from '../../src/core/init.js';
import { createArea } from '../../src/core/area.js';
import { MykbDaemon } from '../../src/daemon/server.js';
import { encodeFrame, FrameDecoder } from '../../src/daemon/transport.js';
import type { Capability } from '../../src/daemon/capability.js';

// L4 SCENARIO level of the testing pyramid (contract §7, capstone):
// the daemon stood on a real temp brain over a REAL Unix socket, driven
// by a real framed JSON-RPC client — a representative verb of each group
// plus an operator-only verb exercised from both capabilities.

let rpcId = 0;

/** Minimal framed JSON-RPC client — one request/response per call. */
function rpc(
  sock: string,
  method: string,
  params: Record<string, unknown>,
): Promise<{ result?: unknown; error?: { data: { kind: string } } }> {
  return new Promise((resolve, reject) => {
    const c = net.connect(sock);
    const dec = new FrameDecoder();
    const id = ++rpcId;
    c.on('connect', () => {
      c.write(encodeFrame(JSON.stringify({ jsonrpc: '2.0', id, method, params })));
    });
    c.on('data', (chunk: Buffer) => {
      const frames = dec.push(chunk);
      if (frames.length > 0) {
        c.end();
        resolve(JSON.parse(frames[0]));
      }
    });
    c.on('error', reject);
  });
}

async function startDaemon(brainPath: string, capability: Capability) {
  const socketPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mykbd-')), 'd.sock');
  const daemon = new MykbDaemon({
    brainPath,
    socketPath,
    resolveCapability: () => capability,
  });
  await daemon.listen();
  return { daemon, socketPath };
}

describe('mykbd scenario — end-to-end over a real Unix socket', () => {
  it('drives a representative verb of each group as an operator connection', async () => {
    await withTempBrain(async (bp) => {
      initBrain(bp);
      createArea(bp, 'docker', 'Docker', 'containers');
      const { daemon, socketPath } = await startDaemon(bp, 'operator');
      try {
        // system
        expect((await rpc(socketPath, 'ping', {})).result).toEqual({ ok: true });
        const hello = (await rpc(socketPath, 'hello', {
          client: 'kb-cli',
          client_version: '0.0.0',
          protocol: 1,
        })) as { result: { capability: string } };
        expect(hello.result.capability).toBe('operator');

        // knowledge add → read
        const add = (await rpc(socketPath, 'add_fact', {
          area: 'docker',
          text: 'cgroups isolate processes',
        })) as { result: { id: string } };
        expect(add.result.id).toMatch(/\w+/);

        // knowledge lifecycle — update_entry
        const upd = await rpc(socketPath, 'update_entry', {
          area: 'docker',
          id: add.result.id,
          updates: { text: 'cgroups isolate processes (edited)' },
        });
        expect(upd.result).toEqual({});

        // knowledge read — load_area reflects the edit
        const load = (await rpc(socketPath, 'load_area', { area: 'docker' })) as {
          result: { entries: { text: string }[] };
        };
        expect(load.result.entries.map((e) => e.text)).toContain(
          'cgroups isolate processes (edited)',
        );

        // workspace group — journal round-trip
        await rpc(socketPath, 'create_workspace', { id: 'ws1', name: 'WS One' });
        await rpc(socketPath, 'append_journal', { id: 'ws1', text: 'scenario ran' });
        const j = (await rpc(socketPath, 'read_journal', { id: 'ws1' })) as {
          result: { entries: { text: string }[] };
        };
        expect(j.result.entries.at(-1)?.text).toBe('scenario ran');

        // operator-only verb from an operator connection → succeeds
        expect((await rpc(socketPath, 'compact', {})).result).toEqual({});

        // supersede reserved → UNSUPPORTED_OP over the wire
        const sup = await rpc(socketPath, 'supersede_entry', {
          area: 'docker',
          old_id: add.result.id,
          new_id: add.result.id,
        });
        expect(sup.error?.data.kind).toBe('UNSUPPORTED_OP');
      } finally {
        await daemon.close();
      }
    });
  });

  it('denies an operator-only verb to an agent connection over the wire', async () => {
    await withTempBrain(async (bp) => {
      initBrain(bp);
      createArea(bp, 'docker', 'Docker', 'containers');
      const { daemon, socketPath } = await startDaemon(bp, 'agent');
      try {
        const add = (await rpc(socketPath, 'add_fact', {
          area: 'docker',
          text: 'agent-written',
        })) as { result: { id: string } };
        const denied = await rpc(socketPath, 'verify_entry', {
          area: 'docker',
          id: add.result.id,
        });
        expect(denied.error?.data.kind).toBe('TRUST_DENIED');
      } finally {
        await daemon.close();
      }
    });
  });

  it('creates the socket file with mode 0600 (contract §4.1)', async () => {
    await withTempBrain(async (bp) => {
      initBrain(bp);
      const { daemon, socketPath } = await startDaemon(bp, 'operator');
      try {
        expect(fs.statSync(socketPath).mode & 0o777).toBe(0o600);
      } finally {
        await daemon.close();
      }
    });
  });

  it('reassembles a request split across two TCP writes', async () => {
    await withTempBrain(async (bp) => {
      initBrain(bp);
      createArea(bp, 'docker', 'Docker', 'c');
      const { daemon, socketPath } = await startDaemon(bp, 'operator');
      try {
        const frame = encodeFrame(
          JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'ping', params: {} }),
        );
        const reply: unknown = await new Promise((resolve, reject) => {
          const c = net.connect(socketPath);
          const dec = new FrameDecoder();
          c.on('connect', () => {
            c.write(frame.subarray(0, 3));
            setTimeout(() => c.write(frame.subarray(3)), 10);
          });
          c.on('data', (chunk: Buffer) => {
            const f = dec.push(chunk);
            if (f.length) {
              c.end();
              resolve(JSON.parse(f[0]));
            }
          });
          c.on('error', reject);
        });
        expect((reply as { result: unknown }).result).toEqual({ ok: true });
      } finally {
        await daemon.close();
      }
    });
  });
});
