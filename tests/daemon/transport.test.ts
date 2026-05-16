import { describe, it, expect } from 'vitest';
import { encodeFrame, FrameDecoder, MAX_FRAME_BYTES } from '../../src/daemon/transport.js';
import { DaemonError } from '../../src/daemon/errors.js';

// L1 transport contract — v2-protocol-contract-DESIGN.md §4.1:
// each frame is `uint32 BE length` ‖ JSON body (UTF-8, that many bytes),
// max body 16 MiB, oversize ⇒ BODY_TOO_LARGE (§6, code -32041).

describe('L1 transport — frame encoding', () => {
  it('prefixes the UTF-8 body with a 4-byte big-endian length', () => {
    const buf = encodeFrame('ab');
    expect(buf).toHaveLength(6);
    expect(buf.readUInt32BE(0)).toBe(2);
    expect(buf.subarray(4).toString('utf8')).toBe('ab');
  });

  it('counts bytes, not characters, for multibyte bodies', () => {
    const body = '☃'; // 3 UTF-8 bytes
    const buf = encodeFrame(body);
    expect(buf.readUInt32BE(0)).toBe(3);
    expect(buf).toHaveLength(7);
    expect(buf.subarray(4).toString('utf8')).toBe(body);
  });

  it('refuses to encode a body larger than MAX_FRAME_BYTES', () => {
    const tooBig = 'x'.repeat(MAX_FRAME_BYTES + 1);
    try {
      encodeFrame(tooBig);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(DaemonError);
      expect((e as DaemonError).kind).toBe('BODY_TOO_LARGE');
      expect((e as DaemonError).code).toBe(-32041);
    }
  });
});

describe('L1 transport — frame decoding / reassembly', () => {
  it('decodes a single whole frame pushed in one chunk', () => {
    const dec = new FrameDecoder();
    expect(dec.push(encodeFrame('hello'))).toEqual(['hello']);
  });

  it('reassembles a frame split across many chunks', () => {
    const dec = new FrameDecoder();
    const frame = encodeFrame('reassemble me');
    const out: string[] = [];
    for (let i = 0; i < frame.length; i++) {
      out.push(...dec.push(frame.subarray(i, i + 1)));
    }
    expect(out).toEqual(['reassemble me']);
  });

  it('returns nothing until the declared length has fully arrived', () => {
    const dec = new FrameDecoder();
    const frame = encodeFrame('partial');
    expect(dec.push(frame.subarray(0, 5))).toEqual([]); // header not even complete
    expect(dec.push(frame.subarray(5, frame.length - 1))).toEqual([]); // body short by 1
    expect(dec.push(frame.subarray(frame.length - 1))).toEqual(['partial']);
  });

  it('decodes multiple frames concatenated in a single chunk', () => {
    const dec = new FrameDecoder();
    const chunk = Buffer.concat([encodeFrame('one'), encodeFrame('two'), encodeFrame('three')]);
    expect(dec.push(chunk)).toEqual(['one', 'two', 'three']);
  });

  it('carries a trailing partial frame over to the next push', () => {
    const dec = new FrameDecoder();
    const a = encodeFrame('first');
    const b = encodeFrame('second');
    const combined = Buffer.concat([a, b]);
    // push first frame + half of the second
    const split = a.length + Math.floor(b.length / 2);
    expect(dec.push(combined.subarray(0, split))).toEqual(['first']);
    expect(dec.push(combined.subarray(split))).toEqual(['second']);
  });

  it('throws BODY_TOO_LARGE when a frame header declares an oversize body', () => {
    const dec = new FrameDecoder();
    const header = Buffer.alloc(4);
    header.writeUInt32BE(MAX_FRAME_BYTES + 1, 0);
    try {
      dec.push(header);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(DaemonError);
      expect((e as DaemonError).kind).toBe('BODY_TOO_LARGE');
      expect((e as DaemonError).code).toBe(-32041);
    }
  });
});
