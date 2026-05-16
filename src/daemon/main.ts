/**
 * `mykbd` entrypoint — `docs/v2-protocol-contract-DESIGN.md` §4.1.
 *
 * Dev-mode launcher (parent DESIGN §Dev-mode strategy: `npm run
 * daemon:dev`). Production supervision (systemd) and the SO_PEERCRED
 * capability resolver are Phase 6 deliverables; this entrypoint runs the
 * daemon against the operator's own brain with the default (operator)
 * capability, which is exactly the trusted dev-mode contract.
 */

import * as os from 'node:os';
import * as path from 'node:path';
import { MykbDaemon } from './server.js';

function defaultBrainPath(): string {
  return process.env.MYKB_DIR ?? path.join(os.homedir(), '.mykb');
}

function defaultSocketPath(brainPath: string): string {
  return process.env.MYKB_SOCKET ?? path.join(brainPath, '.mykbd.sock');
}

export async function main(): Promise<void> {
  const brainPath = defaultBrainPath();
  const socketPath = defaultSocketPath(brainPath);
  const daemon = new MykbDaemon({ brainPath, socketPath });
  await daemon.listen();
  console.error(`mykbd listening on ${socketPath} (brain: ${brainPath})`);

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
