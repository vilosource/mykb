/**
 * JSON-RPC 2.0 envelope — `docs/v2-protocol-contract-DESIGN.md` §4.2–4.3.
 *
 * `params` is always a named object, never positional (§2.1: positional
 * params couple the wire to argument order, an LSP hazard when backends
 * evolve). Every request is correlated by `id`; v2 defines no notifications
 * (§4.2), so a missing/null id is an INVALID_REQUEST, not a fire-and-forget.
 */

import { DaemonError } from './errors.js';

export type JsonRpcId = number | string;

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: JsonRpcId;
  method: string;
  params: Record<string, unknown>;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Parse + validate a raw frame body into a JSON-RPC request. */
export function parseRequest(raw: string): JsonRpcRequest {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    throw new DaemonError('PARSE_ERROR', 'request body is not valid JSON');
  }

  if (!isPlainObject(obj)) {
    throw new DaemonError('INVALID_REQUEST', 'request must be a JSON object');
  }
  if (obj.jsonrpc !== '2.0') {
    throw new DaemonError('INVALID_REQUEST', 'jsonrpc must be exactly "2.0"');
  }
  if (typeof obj.method !== 'string') {
    throw new DaemonError('INVALID_REQUEST', 'method must be a string');
  }
  if (typeof obj.id !== 'number' && typeof obj.id !== 'string') {
    throw new DaemonError(
      'INVALID_REQUEST',
      'id must be a number or string (v2 defines no notifications)',
    );
  }
  let params: Record<string, unknown> = {};
  if (obj.params !== undefined) {
    if (!isPlainObject(obj.params)) {
      throw new DaemonError(
        'INVALID_REQUEST',
        'params must be a named object (positional params are not supported)',
      );
    }
    params = obj.params;
  }

  return { jsonrpc: '2.0', id: obj.id, method: obj.method, params };
}

/** Serialize a JSON-RPC 2.0 success envelope (§4.3). */
export function successResponse(id: JsonRpcId, result: unknown): string {
  return JSON.stringify({ jsonrpc: '2.0', id, result });
}

/**
 * Serialize a JSON-RPC 2.0 error envelope (§4.3). A DaemonError is mapped
 * through its typed taxonomy; any other throwable degrades to
 * INTERNAL_ERROR so an unexpected bug never leaks an untyped error to the
 * wire. `id` is null when the failure happened before an id could be parsed.
 */
export function errorResponse(id: JsonRpcId | null, err: unknown): string {
  const de =
    err instanceof DaemonError
      ? err
      : new DaemonError('INTERNAL_ERROR', err instanceof Error ? err.message : 'internal error');
  return JSON.stringify({ jsonrpc: '2.0', id, error: de.toJsonRpcError() });
}
