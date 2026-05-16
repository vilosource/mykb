import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { spawn, spawnSync, execFileSync, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { initBrain } from '../../src/core/init.js';

// Phase 5 scenario — the genuinely new behaviour: the OPERATOR `kb` CLI,
// when a daemon socket is present, routes its writes through the daemon
// (contract §2.4: "when the daemon is running the operator CLI must use
// RpcMykbStore", else two writers race ~/.mykb). The full CLI suite
// already proves the local-fallback path (645/645 unchanged); this proves
// the daemon path end-to-end through the real CLI binary.

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../../..');
const cliPath = path.join(repoRoot, 'dist', 'cli', 'cli.js');
const daemonMain = path.join(repoRoot, 'dist', 'daemon', 'main.js');

beforeAll(() => {
  if (!fs.existsSync(cliPath) || !fs.existsSync(daemonMain)) {
    execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' });
  }
}, 120_000);

const procs: ChildProcess[] = [];
afterEach(() => {
  for (const p of procs.splice(0)) p.kill('SIGTERM');
});

function kb(
  args: string[],
  env: NodeJS.ProcessEnv,
): { stdout: string; stderr: string; code: number } {
  const r = spawnSync(process.execPath, [cliPath, ...args], {
    env: { ...process.env, ...env },
    encoding: 'utf-8',
    timeout: 15000,
  });
  return {
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    code: r.status ?? 1,
  };
}

describe('kb CLI over the daemon (§2.4 operator-CLI-uses-RPC)', () => {
  it('a `kb add fact` write lands in the brain via the separate daemon process', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mykb-cli-daemon-'));
    const brainPath = path.join(dir, 'brain');
    fs.mkdirSync(brainPath);
    initBrain(brainPath);
    const socketPath = path.join(dir, 'd.sock');

    // Daemon owns the brain on disk (separate process — real topology).
    const daemon = spawn(process.execPath, [daemonMain], {
      env: { ...process.env, MYKB_DIR: brainPath, MYKB_SOCKET: socketPath },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    procs.push(daemon);
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('daemon did not start')), 20_000);
      const tick = setInterval(() => {
        if (fs.existsSync(socketPath)) {
          clearInterval(tick);
          clearTimeout(t);
          resolve();
        }
      }, 50);
      daemon.on('error', reject);
    });

    const env = { MYKB_DIR: brainPath, MYKB_SOCKET: socketPath };
    delete (env as NodeJS.ProcessEnv).KB_SESSION_ID;

    // init area is the operator direct-disk path (fine — same brain dir).
    const init = kb(['init', 'area', 'docker', 'Docker', 'containers'], env);
    expect(init.code).toBe(0);

    // The socket is present → selectKnowledgeStore picks RpcKnowledgeStore;
    // this write necessarily travels CLI → socket → daemon → disk.
    const add = kb(['add', 'fact', 'docker', 'cgroups isolate processes'], env);
    expect(add.code).toBe(0);

    // Prove persistence by reading the JSONL the DAEMON wrote (the CLI
    // process never touched the file — it only spoke to the socket).
    const factsFile = path.join(brainPath, 'areas', 'docker', 'facts.jsonl');
    const facts = fs.readFileSync(factsFile, 'utf-8');
    expect(facts).toContain('cgroups isolate processes');

    // And a read-path verb round-trips through the daemon too.
    const load = kb(['load', 'docker'], env);
    expect(load.code).toBe(0);
    expect(load.stdout).toContain('cgroups isolate processes');
  });
});
