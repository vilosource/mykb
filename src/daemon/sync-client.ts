/**
 * Synchronous RPC client — blocking Unix-socket round-trip.
 *
 * The `KnowledgeStore` / `WorkspaceStorage` interfaces are synchronous
 * (`addFact(): string`, not `Promise`). The parent DESIGN's Adapter
 * (`RpcMykbStore adapts the EXISTING MykbStore interface`) requires the
 * RPC client to present synchronously so there is zero ripple into the
 * extension hooks and CLI subcommands (Phases 4–5). Socket I/O in Node is
 * async, so a worker thread owns the socket and the caller blocks on
 * `Atomics.wait` until the worker signals — the canonical sync-over-async
 * bridge (one in-flight request at a time, which is exactly the call
 * pattern of the store interface).
 *
 * Caveat (inherent, not a bug): a synchronous client blocks its own
 * event loop while waiting. It therefore MUST NOT share a process/event
 * loop with an in-process `MykbDaemon` — the blocked loop would starve
 * the daemon and deadlock. In the real v2 topology the daemon is a
 * separate host process, so this never arises in production; tests run
 * the daemon as a child process for the same reason.
 *
 * The worker is an inline `eval` worker so it needs no compiled-module
 * resolution (a known Worker+TS pain). It re-implements the 4-byte
 * length-prefix frame codec — deliberately kept identical to
 * `transport.ts` §4.1; a divergence here is a wire bug, covered by the
 * scenario tests that exercise this client against the real daemon.
 */

import {
  Worker,
  MessageChannel,
  receiveMessageOnPort,
  type MessagePort,
} from 'node:worker_threads';
import { DaemonError, type DaemonErrorKind } from './errors.js';

const WORKER_SRC = `
const { workerData } = require('node:worker_threads');
const net = require('node:net');
const { socketPath, sab, port } = workerData;
const sig = new Int32Array(sab);
let seq = 0;

function encodeFrame(body) {
  const payload = Buffer.from(body, 'utf8');
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32BE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

function request(method, params) {
  return new Promise((resolve, reject) => {
    const c = net.connect(socketPath);
    let buf = Buffer.alloc(0);
    const id = ++seq;
    c.on('connect', () => {
      c.write(encodeFrame(JSON.stringify({ jsonrpc: '2.0', id, method, params })));
    });
    c.on('data', (chunk) => {
      buf = buf.length === 0 ? chunk : Buffer.concat([buf, chunk]);
      if (buf.length < 4) return;
      const len = buf.readUInt32BE(0);
      if (buf.length < 4 + len) return;
      const body = buf.subarray(4, 4 + len).toString('utf8');
      c.end();
      try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
    });
    c.on('error', reject);
  });
}

port.on('message', async (req) => {
  let reply;
  try {
    reply = await request(req.method, req.params);
  } catch (e) {
    reply = { error: { message: String(e && e.message || e), data: { kind: 'BACKEND_UNAVAILABLE' } } };
  }
  // postMessage BEFORE the Atomics notify so the main thread's
  // receiveMessageOnPort finds the reply already queued when it wakes.
  port.postMessage(reply);
  Atomics.store(sig, 0, 1);
  Atomics.notify(sig, 0);
});
`;

interface RpcReply {
  result?: unknown;
  error?: { message: string; data: { kind: DaemonErrorKind; detail?: Record<string, unknown> } };
}

export class SyncRpcClient {
  private readonly worker: Worker;
  private readonly port: MessagePort;
  private readonly sig: Int32Array;
  private closed = false;

  private workerError?: Error;

  constructor(
    socketPath: string,
    private readonly timeoutMs = 15_000,
  ) {
    const sab = new SharedArrayBuffer(8);
    this.sig = new Int32Array(sab);
    const channel = new MessageChannel();
    this.port = channel.port1;
    this.worker = new Worker(WORKER_SRC, {
      eval: true,
      workerData: { socketPath, sab, port: channel.port2 },
      transferList: [channel.port2],
    });
    // A worker bootstrap/runtime failure would otherwise deadlock the
    // blocked caller forever (Atomics.wait freezes the main thread, so the
    // 'error' event can't be processed until the wait times out). Capture
    // it so the post-timeout path can surface the real cause.
    this.worker.on('error', (e: Error) => {
      this.workerError = e;
    });
    // The worker thread must not keep the process alive on its own.
    this.worker.unref();
  }

  /** Blocking request. Returns the JSON-RPC `result`; throws DaemonError. */
  call(method: string, params: Record<string, unknown>): unknown {
    if (this.closed) {
      throw new DaemonError('BACKEND_UNAVAILABLE', 'RPC client already closed');
    }
    Atomics.store(this.sig, 0, 0);
    this.port.postMessage({ method, params });
    const woke = Atomics.wait(this.sig, 0, 0, this.timeoutMs);
    if (woke === 'timed-out') {
      // Fail-fast (contract §2.3). If the worker died, surface why.
      this.close();
      throw new DaemonError(
        'BACKEND_UNAVAILABLE',
        this.workerError
          ? `RPC worker failed: ${this.workerError.message}`
          : `RPC call '${method}' timed out after ${this.timeoutMs}ms`,
      );
    }
    const msg = receiveMessageOnPort(this.port);
    if (!msg) {
      throw new DaemonError('INTERNAL_ERROR', 'no reply from RPC worker');
    }
    const reply = msg.message as RpcReply;
    if (reply.error) {
      throw new DaemonError(
        reply.error.data?.kind ?? 'INTERNAL_ERROR',
        reply.error.message,
        reply.error.data?.detail,
      );
    }
    return reply.result;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    void this.worker.terminate();
  }
}
