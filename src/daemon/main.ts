/**
 * `mykbd` entrypoint — `docs/v2-protocol-contract-DESIGN.md` §4.1 / §2.2.
 *
 * Two modes:
 *
 *  - **dev / single-socket** (default, `npm run daemon:dev`): one socket,
 *    `operator` capability — the trusted host-operator loop (parent
 *    DESIGN §Dev-mode).
 *  - **production / dual-socket**: set `MYKB_OPERATOR_SOCKET` +
 *    `MYKB_AGENT_SOCKET`. The operator socket (0600) is host-local; the
 *    agent socket (0666) is the one bind-mounted into the Pi container.
 *    Capability is decided by which socket the connection arrives on
 *    (§2.2 amended — no SO_PEERCRED needed). Run under systemd
 *    (`deploy/mykbd.service`); see `docs/v2-container-topology.md`.
 */

import * as os from 'node:os';
import * as path from 'node:path';
import { MykbDaemon } from './server.js';
import { DualSocketDaemon } from './dual-socket.js';

function defaultBrainPath(): string {
  return process.env.MYKB_DIR ?? path.join(os.homedir(), '.mykb');
}

function defaultSocketPath(brainPath: string): string {
  return process.env.MYKB_SOCKET ?? path.join(brainPath, '.mykbd.sock');
}

interface Runnable {
  listen(): Promise<void>;
  close(): Promise<void>;
}

export async function main(): Promise<void> {
  const brainPath = defaultBrainPath();
  const op = process.env.MYKB_OPERATOR_SOCKET;
  const ag = process.env.MYKB_AGENT_SOCKET;

  let daemon: Runnable;
  let banner: string;
  if (op && ag) {
    daemon = new DualSocketDaemon({
      brainPath,
      operatorSocketPath: op,
      agentSocketPath: ag,
    });
    banner = `mykbd (dual-socket) operator=${op} agent=${ag} (brain: ${brainPath})`;
  } else {
    const socketPath = defaultSocketPath(brainPath);
    daemon = new MykbDaemon({ brainPath, socketPath });
    banner = `mykbd (single-socket, operator) ${socketPath} (brain: ${brainPath})`;
  }

  await daemon.listen();
  console.error(banner);

  const shutdown = () => {
    daemon
      .close()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Run only when invoked directly (not when imported by a test).
if (
  process.argv[1] &&
  (process.argv[1].endsWith('main.js') || process.argv[1].endsWith('main.ts'))
) {
  main().catch((e) => {
    console.error('mykbd failed to start:', e);
    process.exit(1);
  });
}
