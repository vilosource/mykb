/**
 * L1 transport — frame codec.
 *
 * Wire framing per `docs/v2-protocol-contract-DESIGN.md` §4.1:
 *   `uint32 BE length` ‖ JSON body (UTF-8, exactly that many bytes).
 *
 * A byte-count prefix (not a newline delimiter) is used because brain
 * content carries arbitrary newlines (contract §2.1). Bodies over
 * MAX_FRAME_BYTES are rejected with BODY_TOO_LARGE (§6, code -32041);
 * larger payloads are a future explicit streaming verb (§8), never a
 * silently-allowed oversize frame.
 */

import { DaemonError } from './errors.js';

/** 16 MiB — contract §4.1. */
export const MAX_FRAME_BYTES = 16 * 1024 * 1024;

const HEADER_BYTES = 4;

/** Encode a JSON body string into a length-prefixed frame. */
export function encodeFrame(body: string): Buffer {
  const payload = Buffer.from(body, 'utf8');
  if (payload.length > MAX_FRAME_BYTES) {
    throw new DaemonError(
      'BODY_TOO_LARGE',
      `frame body ${payload.length} bytes exceeds the ${MAX_FRAME_BYTES}-byte limit`,
      { bytes: payload.length, limit: MAX_FRAME_BYTES },
    );
  }
  const header = Buffer.allocUnsafe(HEADER_BYTES);
  header.writeUInt32BE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

/**
 * Streaming frame reassembler. Stateful across `push` calls: a socket
 * delivers arbitrary chunk boundaries, so a frame may arrive split across
 * many chunks or several frames may arrive coalesced in one chunk
 * (contract §7.1: "partial-frame reassembly").
 */
export class FrameDecoder {
  private buffer: Buffer = Buffer.alloc(0);

  /**
   * Feed a chunk; return every frame body that completed as a result.
   * Throws BODY_TOO_LARGE as soon as a header declares an oversize body
   * (fail before buffering the payload).
   */
  push(chunk: Buffer): string[] {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);

    const out: string[] = [];
    for (;;) {
      if (this.buffer.length < HEADER_BYTES) break;
      const len = this.buffer.readUInt32BE(0);
      if (len > MAX_FRAME_BYTES) {
        throw new DaemonError(
          'BODY_TOO_LARGE',
          `incoming frame declares ${len} bytes, over the ${MAX_FRAME_BYTES}-byte limit`,
          { declared: len, limit: MAX_FRAME_BYTES },
        );
      }
      if (this.buffer.length < HEADER_BYTES + len) break; // body not fully arrived
      const body = this.buffer.subarray(HEADER_BYTES, HEADER_BYTES + len);
      out.push(body.toString('utf8'));
      this.buffer = this.buffer.subarray(HEADER_BYTES + len);
    }
    return out;
  }
}
