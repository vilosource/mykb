/**
 * Connection capability — `docs/v2-protocol-contract-DESIGN.md` §2.2.
 *
 * Derived by the daemon from the connecting peer's OS credentials
 * (`SO_PEERCRED`) at accept time, NOT from anything the client asserts.
 * The kernel attests the peer uid; the daemon does not trust a client's
 * self-declared trust level beyond its connection capability. This is the
 * single mechanism that both resolves the parent DESIGN's auth open-decision
 * and closes the envelope-v2 trust-forgery hole (§3.1a).
 *
 *  - `operator`: peer uid owns the brain. May call maintenance verbs and
 *    may assert `trust: 'operator'` on writes.
 *  - `agent`: any other peer (the in-container Pi extension). Mutation +
 *    read + workspace verbs only; any asserted trust is capped at `agent`.
 */
export type Capability = 'operator' | 'agent';

export interface ConnContext {
  capability: Capability;
}
