/**
 * Dual capability sockets — `docs/v2-protocol-contract-DESIGN.md` §2.2
 * (amended Phase 6).
 *
 * Node exposes no public `SO_PEERCRED` API, so capability is established
 * by *which socket a connection arrives on*, with the kernel enforcing
 * who may `connect()`:
 *
 *  - **operator socket** — mode `0600`, owned by the brain uid. Only the
 *    brain-owning uid (the host operator) can connect. ⇒ `operator`.
 *  - **agent socket** — mode `0666`, bind-mounted into the Pi container
 *    (a different uid). ⇒ `agent`; asserted `trust` capped at `agent`.
 *
 * `0666` on the agent socket is safe by design: *access is not
 * privilege*. A connection there only ever gets the `agent` capability —
 * it cannot call operator-only verbs nor assert `trust:'operator'` (the
 * dispatcher gate, §5/§3.1a). The socket is also only bind-mounted into
 * the trusted container, never exposed host-wide.
 *
 * Both sockets share ONE Dispatcher (one process, the sole writer), so
 * the daemon's single event loop serializes JSONL appends across them.
 */

import { MykbDaemon } from './server.js';
import { Dispatcher } from './dispatch.js';

export interface DualSocketOptions {
  brainPath: string;
  operatorSocketPath: string;
  agentSocketPath: string;
}

export class DualSocketDaemon {
  private readonly operator: MykbDaemon;
  private readonly agent: MykbDaemon;

  constructor(opts: DualSocketOptions) {
    const dispatcher = new Dispatcher(opts.brainPath);
    this.operator = new MykbDaemon({
      brainPath: opts.brainPath,
      socketPath: opts.operatorSocketPath,
      resolveCapability: () => 'operator',
      socketMode: 0o600,
      dispatcher,
    });
    this.agent = new MykbDaemon({
      brainPath: opts.brainPath,
      socketPath: opts.agentSocketPath,
      resolveCapability: () => 'agent',
      socketMode: 0o666,
      dispatcher,
    });
  }

  async listen(): Promise<void> {
    await Promise.all([this.operator.listen(), this.agent.listen()]);
  }

  async close(): Promise<void> {
    await Promise.all([this.operator.close(), this.agent.close()]);
  }
}
