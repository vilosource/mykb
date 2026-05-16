/**
 * L1 server — Unix-socket listener tying transport + JSON-RPC + L4
 * dispatch together (`docs/v2-protocol-contract-DESIGN.md` §4).
 *
 * Per connection: a stateful FrameDecoder (§4.1 — chunk boundaries are
 * arbitrary), each completed frame parsed as a JSON-RPC request (§4.2),
 * dispatched through the L4 facade with the connection's capability, and
 * the result/error written back as a framed JSON-RPC response (§4.3).
 *
 * Capability resolution (§2.2) is injected as a Strategy (DIP): the
 * production SO_PEERCRED resolver — reading the connecting peer's uid from
 * the kernel — lands in Phase 6, where the daemon runs as a managed
 * service and the container topology is in place. Node exposes no public
 * SO_PEERCRED API, so faking it in the scaffold would be dishonest; the
 * seam is explicit instead. The default resolver returns `operator`
 * (dev-mode: the operator runs the daemon against their own brain — parent
 * DESIGN §Dev-mode strategy); tests inject per-scenario resolvers.
 */

import * as net from 'node:net';
import * as fs from 'node:fs';
import { FrameDecoder, encodeFrame } from './transport.js';
import { parseRequest, successResponse, errorResponse } from './jsonrpc.js';
import { Dispatcher } from './dispatch.js';
import type { Capability } from './capability.js';

export interface DaemonOptions {
  brainPath: string;
  socketPath: string;
  /** Strategy seam for §2.2 capability resolution; default → 'operator'. */
  resolveCapability?: (socket: net.Socket) => Capability;
}

export class MykbDaemon {
  private readonly opts: DaemonOptions;
  private readonly dispatcher: Dispatcher;
  private server?: net.Server;

  constructor(opts: DaemonOptions) {
    this.opts = opts;
    this.dispatcher = new Dispatcher(opts.brainPath);
  }

  listen(): Promise<void> {
    // Clear a stale socket from an unclean prior shutdown.
    if (fs.existsSync(this.opts.socketPath)) fs.unlinkSync(this.opts.socketPath);

    const server = net.createServer((socket) => this.onConnection(socket));
    this.server = server;

    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.opts.socketPath, () => {
        // 0600: only the brain-owning uid may even connect (defence in
        // depth; capability still derives from SO_PEERCRED, not the mode).
        fs.chmodSync(this.opts.socketPath, 0o600);
        server.off('error', reject);
        resolve();
      });
    });
  }

  private onConnection(socket: net.Socket): void {
    const decoder = new FrameDecoder();
    const capability: Capability = this.opts.resolveCapability
      ? this.opts.resolveCapability(socket)
      : 'operator';

    socket.on('data', (chunk: Buffer) => {
      let frames: string[];
      try {
        frames = decoder.push(chunk);
      } catch (e) {
        // Transport-level failure (e.g. BODY_TOO_LARGE): no id is known.
        socket.write(encodeFrame(errorResponse(null, e)));
        socket.end();
        return;
      }
      for (const frame of frames) {
        socket.write(encodeFrame(this.handle(frame, capability)));
      }
    });

    socket.on('error', () => {
      /* client vanished mid-write — the daemon survives (parent DESIGN
         §Experiments: "daemon survives client crashes mid-transaction") */
    });
  }

  /** One request frame → one response frame body. Never throws. */
  private handle(frame: string, capability: Capability): string {
    let id: string | number | null = null;
    try {
      const req = parseRequest(frame);
      id = req.id;
      const result = this.dispatcher.dispatch(req.method, req.params, {
        capability,
      });
      return successResponse(req.id, result);
    } catch (e) {
      return errorResponse(id, e);
    }
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => {
        if (fs.existsSync(this.opts.socketPath)) {
          try {
            fs.unlinkSync(this.opts.socketPath);
          } catch {
            /* already gone */
          }
        }
        resolve();
      });
    });
  }
}
