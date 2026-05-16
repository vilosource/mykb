import { describe, it, expect } from 'vitest';
import { parseRequest, successResponse, errorResponse } from '../../src/daemon/jsonrpc.js';
import { DaemonError } from '../../src/daemon/errors.js';

// JSON-RPC 2.0 envelope — v2-protocol-contract-DESIGN.md §4.2–4.3.
// params is ALWAYS a named object (never positional, §2.1). Every request
// is correlated by id; v2 defines no notifications (§4.2: "omit id only for
// fire-and-forget notifications (none defined in v2)").

describe('parseRequest', () => {
  it('parses a well-formed request and defaults absent params to {}', () => {
    const req = parseRequest('{"jsonrpc":"2.0","id":1,"method":"ping"}');
    expect(req).toEqual({ jsonrpc: '2.0', id: 1, method: 'ping', params: {} });
  });

  it('keeps a string id and a named params object', () => {
    const req = parseRequest(
      '{"jsonrpc":"2.0","id":"abc","method":"add_fact","params":{"area":"x","text":"y"}}',
    );
    expect(req.id).toBe('abc');
    expect(req.params).toEqual({ area: 'x', text: 'y' });
  });

  it('rejects malformed JSON with PARSE_ERROR', () => {
    try {
      parseRequest('{not json');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(DaemonError);
      expect((e as DaemonError).kind).toBe('PARSE_ERROR');
      expect((e as DaemonError).code).toBe(-32700);
    }
  });

  it('rejects a wrong jsonrpc version with INVALID_REQUEST', () => {
    expect(() => parseRequest('{"jsonrpc":"1.0","id":1,"method":"ping"}')).toThrow(DaemonError);
    try {
      parseRequest('{"jsonrpc":"1.0","id":1,"method":"ping"}');
    } catch (e) {
      expect((e as DaemonError).kind).toBe('INVALID_REQUEST');
      expect((e as DaemonError).code).toBe(-32600);
    }
  });

  it('rejects a non-string method with INVALID_REQUEST', () => {
    try {
      parseRequest('{"jsonrpc":"2.0","id":1,"method":42}');
      expect.unreachable();
    } catch (e) {
      expect((e as DaemonError).kind).toBe('INVALID_REQUEST');
    }
  });

  it('rejects a missing id with INVALID_REQUEST (no notifications in v2)', () => {
    try {
      parseRequest('{"jsonrpc":"2.0","method":"ping"}');
      expect.unreachable();
    } catch (e) {
      expect((e as DaemonError).kind).toBe('INVALID_REQUEST');
    }
  });

  it('rejects a null id with INVALID_REQUEST', () => {
    try {
      parseRequest('{"jsonrpc":"2.0","id":null,"method":"ping"}');
      expect.unreachable();
    } catch (e) {
      expect((e as DaemonError).kind).toBe('INVALID_REQUEST');
    }
  });

  it('rejects positional (array) params with INVALID_REQUEST', () => {
    try {
      parseRequest('{"jsonrpc":"2.0","id":1,"method":"add_fact","params":[1,2]}');
      expect.unreachable();
    } catch (e) {
      expect((e as DaemonError).kind).toBe('INVALID_REQUEST');
    }
  });
});

describe('successResponse', () => {
  it('wraps the result in a JSON-RPC 2.0 success envelope', () => {
    const s = successResponse(7, { id: 'abc123' });
    expect(JSON.parse(s)).toEqual({
      jsonrpc: '2.0',
      id: 7,
      result: { id: 'abc123' },
    });
  });
});

describe('errorResponse', () => {
  it('serializes a DaemonError via its JSON-RPC mapping with the typed kind', () => {
    const err = new DaemonError('AREA_NOT_FOUND', 'no such area: zzz', {
      area: 'zzz',
    });
    const parsed = JSON.parse(errorResponse(3, err));
    expect(parsed).toEqual({
      jsonrpc: '2.0',
      id: 3,
      error: {
        code: -32001,
        message: 'no such area: zzz',
        data: { kind: 'AREA_NOT_FOUND', detail: { area: 'zzz' } },
      },
    });
  });

  it('maps an unexpected non-DaemonError to INTERNAL_ERROR (-32603)', () => {
    const parsed = JSON.parse(errorResponse(9, new Error('boom')));
    expect(parsed.id).toBe(9);
    expect(parsed.error.code).toBe(-32603);
    expect(parsed.error.data.kind).toBe('INTERNAL_ERROR');
  });

  it('uses a null id when the failure happened before an id could be parsed', () => {
    const parsed = JSON.parse(errorResponse(null, new DaemonError('PARSE_ERROR', 'bad')));
    expect(parsed.id).toBeNull();
    expect(parsed.error.data.kind).toBe('PARSE_ERROR');
  });
});
