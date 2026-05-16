import { describe, it, expect, afterEach } from 'vitest';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { withTempBrain } from '../helpers.js';
import { initBrain } from '../../src/core/init.js';
import { createArea } from '../../src/core/area.js';
import { DualSocketDaemon } from '../../src/daemon/dual-socket.js';
import { encodeFrame, FrameDecoder } from '../../src/daemon/transport.js';

// Phase 6 — dual capability sockets (contract §2.2 amended): which socket
// a connection arrives on determines its capability; the kernel enforces
// who may connect() to the 0600 operator socket. No SO_PEERCRED needed.

let rpcId = 0;
function rpc(sock: string, method: string, params: Record<string, unknown>) {
  return new Promise<{ result?: unknown; error?: { data: { kind: string } } }>(
    (resolve, reject) => {
      const c = net.connect(sock);
      const dec = new FrameDecoder();
      const id = ++rpcId;
      c.on('connect', () =>
        c.write(encodeFrame(JSON.stringify({ jsonrpc: '2.0', id, method, params }))),
      );
      c.on('data', (chunk: Buffer) => {
        const f = dec.push(chunk);
        if (f.length) {
          c.end();
          resolve(JSON.parse(f[0]));
        }
      });
      c.on('error', reject);
    },
  );
}

const daemons: DualSocketDaemon[] = [];
afterEach(async () => {
  for (const d of daemons.splice(0)) await d.close();
});

async function start(brainPath: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mykbd-dual-'));
  const operatorSocketPath = path.join(dir, 'op.sock');
  const agentSocketPath = path.join(dir, 'agent.sock');
  const d = new DualSocketDaemon({ brainPath, operatorSocketPath, agentSocketPath });
  await d.listen();
  daemons.push(d);
  return { d, operatorSocketPath, agentSocketPath };
}

describe('DualSocketDaemon — capability by socket', () => {
  it('a connection on the operator socket has operator capability', async () => {
    await withTempBrain(async (bp) => {
      initBrain(bp);
      createArea(bp, 'docker', 'Docker', 'c');
      const { operatorSocketPath } = await start(bp);
      const add = (await rpc(operatorSocketPath, 'add_fact', {
        area: 'docker',
        text: 'op fact',
      })) as { result: { id: string } };
      // verify_entry is operator-only (§5.2) — must succeed here.
      const v = await rpc(operatorSocketPath, 'verify_entry', {
        area: 'docker',
        id: add.result.id,
      });
      expect(v.result).toEqual({});
    });
  });

  it('a connection on the agent socket has agent capability', async () => {
    await withTempBrain(async (bp) => {
      initBrain(bp);
      createArea(bp, 'docker', 'Docker', 'c');
      const { operatorSocketPath, agentSocketPath } = await start(bp);
      const add = (await rpc(operatorSocketPath, 'add_fact', {
        area: 'docker',
        text: 'shared fact',
      })) as { result: { id: string } };
      // Same brain, but verify_entry over the AGENT socket → TRUST_DENIED.
      const denied = await rpc(agentSocketPath, 'verify_entry', {
        area: 'docker',
        id: add.result.id,
      });
      expect(denied.error?.data.kind).toBe('TRUST_DENIED');
      // …while a normal agent write still works on the agent socket.
      const ok = await rpc(agentSocketPath, 'add_fact', {
        area: 'docker',
        text: 'agent fact',
      });
      expect((ok as { result: { id: string } }).result.id).toMatch(/\w+/);
    });
  });

  it('the operator socket is created mode 0600; the agent socket is group/other-connectable', async () => {
    await withTempBrain(async (bp) => {
      initBrain(bp);
      const { operatorSocketPath, agentSocketPath } = await start(bp);
      expect(fs.statSync(operatorSocketPath).mode & 0o777).toBe(0o600);
      // agent socket must be connectable by the container (different uid):
      // at least group/other read+write.
      expect(fs.statSync(agentSocketPath).mode & 0o066).not.toBe(0);
    });
  });

  it('both sockets share one brain (writes on one are visible on the other)', async () => {
    await withTempBrain(async (bp) => {
      initBrain(bp);
      createArea(bp, 'docker', 'Docker', 'c');
      const { operatorSocketPath, agentSocketPath } = await start(bp);
      await rpc(agentSocketPath, 'add_fact', { area: 'docker', text: 'via agent' });
      const load = (await rpc(operatorSocketPath, 'load_area', {
        area: 'docker',
      })) as { result: { entries: { text: string }[] } };
      expect(load.result.entries.map((e) => e.text)).toContain('via agent');
    });
  });
});
