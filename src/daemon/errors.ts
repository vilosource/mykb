/**
 * Daemon error taxonomy — canonical, transcribed from
 * `docs/v2-protocol-contract-DESIGN.md` §6.
 *
 * Clients branch on `kind` (the stable discriminator), never on `message`
 * (human prose) — see contract §4.3. `code` follows JSON-RPC conventions:
 * standard codes in the -32600..-32700 band, domain codes in the
 * implementation-defined -32000..-32099 band.
 *
 * Only the kinds whose trigger conditions have a test land "live" per slice
 * (TDD); the full table is defined here because it is contract data, not
 * speculative behaviour. A kind without a producing code path yet is simply
 * unused until its slice implements + tests it.
 */

export type DaemonErrorKind =
  // L3 repositories
  | 'AREA_NOT_FOUND'
  | 'ENTRY_NOT_FOUND'
  | 'WORKSPACE_NOT_FOUND'
  // L3 Chain-of-Responsibility validators (ordered)
  | 'SCHEMA_INVALID'
  | 'ID_CONFLICT'
  | 'TOMBSTONE_ORDER'
  | 'FTS_SYNC_FAILED'
  // L4 facade — capability enforcement
  | 'TRUST_DENIED'
  // L2 storage backend
  | 'READ_ONLY_BACKEND'
  | 'BACKEND_UNAVAILABLE'
  | 'LOCK_TIMEOUT'
  | 'UNSUPPORTED_OP'
  // L1 transport
  | 'BODY_TOO_LARGE'
  // JSON-RPC standard (re-exposed as kinds for uniform client handling)
  | 'PARSE_ERROR'
  | 'INVALID_REQUEST'
  | 'METHOD_NOT_FOUND'
  | 'INVALID_PARAMS'
  | 'INTERNAL_ERROR';

/** Stable kind → JSON-RPC code map (contract §6). */
export const KIND_CODES: Record<DaemonErrorKind, number> = {
  AREA_NOT_FOUND: -32001,
  ENTRY_NOT_FOUND: -32002,
  WORKSPACE_NOT_FOUND: -32003,
  SCHEMA_INVALID: -32010,
  ID_CONFLICT: -32011,
  TOMBSTONE_ORDER: -32012,
  FTS_SYNC_FAILED: -32013,
  TRUST_DENIED: -32020,
  READ_ONLY_BACKEND: -32021,
  BACKEND_UNAVAILABLE: -32030,
  LOCK_TIMEOUT: -32031,
  UNSUPPORTED_OP: -32040,
  BODY_TOO_LARGE: -32041,
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
};

/**
 * A typed daemon error. Carries the contract `kind`, its JSON-RPC `code`,
 * and an optional machine-usable `detail` payload (contract §4.3:
 * `error.data.detail` so the client/LLM can correct and retry through the
 * cooperative path rather than reaching for `bash`).
 */
export class DaemonError extends Error {
  readonly kind: DaemonErrorKind;
  readonly code: number;
  readonly detail?: Record<string, unknown>;

  constructor(kind: DaemonErrorKind, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = 'DaemonError';
    this.kind = kind;
    this.code = KIND_CODES[kind];
    this.detail = detail;
  }

  /** Serialize to a JSON-RPC 2.0 `error` object (contract §4.3). */
  toJsonRpcError(): {
    code: number;
    message: string;
    data: { kind: DaemonErrorKind; detail?: Record<string, unknown> };
  } {
    return {
      code: this.code,
      message: this.message,
      data: { kind: this.kind, detail: this.detail },
    };
  }
}
