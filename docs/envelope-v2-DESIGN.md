# Entry Envelope v2 — Bi-temporal Validity, Trust Level, Structured Provenance

> Status: design — implements §16 commitments 3, 8, 9 from `v2-harness-memory-RESEARCH.md`.
> Companion docs: `curator-v2-DESIGN.md`, `two-stage-retrieval-DESIGN.md`.

## Problem

The current `KnowledgeEntry` envelope (`src/core/types.ts:31`) cannot express three things v2 requires:

1. **When a fact is true.** A 2024-recorded fact about a deprecated server still loads in 2026 with no signal that it has expired. The single `updated` timestamp tells us when the row was last touched, not the validity window of the claim it carries.
2. **Whether to trust the author.** Operator-written, agent-written, and bulk-imported entries are indistinguishable downstream. An LLM-authored entry that was never reviewed can land in the always-loaded Tier-1 set alongside an operator-curated pattern.
3. **Where the claim came from.** The `provenance.source` field is free-text (e.g. `"chat 2024-09-12"`). It cannot be mechanically re-validated, cross-referenced against git history, or used to resolve contradictions.

The research brief (§3, §6, §3.4) traces these gaps to Graphiti's bi-temporal model and OWASP MCP Top 10 supply-chain risks.

## Current state

```ts
// src/core/types.ts:22
export type Provenance = {
  status: ProvenanceStatus;
  date?: string;
  source?: string;
  detail?: string;
};

// src/core/types.ts:31
export type KnowledgeEntry = {
  id: string;
  area: string;
  type: EntryType;
  text: string;
  tags: string[];
  provenance: Provenance;
  zone: Zone;
  created: string;
  updated: string;
};
```

`ProvenanceStatus` enumerates `verified | unverified | stale | expires` — useful triage states, but they describe *review status*, not *temporal validity* or *trust origin*.

## Proposed envelope

Three additive changes. None replace existing fields; old rows continue to load with sensible defaults.

### 1. Bi-temporal validity (commitment 3)

Add to `KnowledgeEntry`:

```ts
type Validity = {
  valid_from: string;                 // ISO date — when the claim became true (event time)
  valid_until?: string;                // ISO date — when it stopped being true, if known (event time)
  recorded_invalid_at?: string;        // ISO date — when WE recorded the invalidation (system time)
  superseded_by?: string;              // entry id that replaces this one
};

export type KnowledgeEntry = {
  // ... existing fields ...
  validity: Validity;
};
```

Semantics:

- `valid_from` defaults to `created` for entries authored after this change lands; backfilled to `created` for legacy rows during migration (best-effort, see §Migration).
- `valid_until` is `undefined` for entries believed currently true. Setting it does **not** archive the entry — archive is a separate lifecycle concern. An entry can be `Zone.Established` and `valid_until=2025-11-01`; that means "this was the answer in 2025, kept for historical lookup, do not surface as current."
- `superseded_by` is the explicit replacement pointer. The retrieval layer uses it to demote rather than delete: if entry A is superseded by B, A is filtered out of default queries but reachable via `--include-superseded`.
- `recorded_invalid_at` is the **system-time end**: when *we recorded* that the fact stopped being true, as distinct from `valid_until` (when it *actually* stopped). Set atomically alongside `valid_until` / `superseded_by`; `undefined` while the fact is believed current. This is the field that answers retrospective audit queries — "what did we believe about X on date D" — which `updated` cannot, because `updated` is rewritten on any mutation (e.g. a tag edit; see `knowledge-store.ts:191`).

The pair `(valid_from, valid_until)` is the **event-time** interval (when the claim was true in the world). The pair `(created, recorded_invalid_at)` is the **system-time** interval (when mykb believed it). Both pairs together give the true 2×2 bi-temporal model Graphiti uses (`valid_at`/`invalid_at` + `created_at`/`expired_at`). Note `updated` is *not* the system-time end — it is last-touch time and must not be relied on for temporal queries (corrected per `graphiti-reevaluation-2026-05-18.md`).

### 2. Trust level (commitment 8)

Add a discriminator for who authored the entry:

```ts
export type TrustLevel = 'operator' | 'agent' | 'import';

export type KnowledgeEntry = {
  // ... existing fields ...
  trust: TrustLevel;
};
```

- `operator` — created by a human via `kb add …` from a terminal session the user is sitting at.
- `agent` — created by an autonomous or semi-autonomous agent (background curator, hook handler, slash command run unattended).
- `import` — bulk-imported from another system (OSB migration, JSONL import, future MCP imports if reintroduced).

The CLI infers trust level from invocation context:

| Invocation                                            | Trust       |
|-------------------------------------------------------|-------------|
| Interactive terminal (`process.stdin.isTTY === true`) | `operator`  |
| Hook (`MYKB_INVOCATION=hook` env var)                 | `agent`     |
| Background agent (`MYKB_INVOCATION=agent`)            | `agent`     |
| `kb import` and migration scripts                     | `import`    |
| Default / unknown                                     | `agent`     |

The default is `agent` (not `operator`) by design: misclassifying an agent write as operator is a security regression; the inverse is just an extra review step.

**Tier-1 gating.** The retrieval layer (`src/extension/scorer.ts`) treats `trust !== 'operator'` as a soft demotion: agent/import entries can still be retrieved by explicit search, but they are excluded from the always-injected Tier-1 budget unless they have been promoted (`kb verify` becomes the operator-trust signal, see §Migration). This makes prompt-injection-poisoned entries unable to reach the always-loaded context without operator review.

### 3. Structured provenance (commitment 9)

Replace `Provenance` with a typed shape that retains the existing fields and adds machine-checkable origin pointers:

```ts
export type ProvenanceOrigin =
  | { kind: 'commit'; repo: string; sha: string; path?: string; line?: number }
  | { kind: 'message'; thread_id: string; message_id: string }
  | { kind: 'tool_call'; tool: string; call_id: string }
  | { kind: 'manual' };

export type Provenance = {
  status: ProvenanceStatus;          // existing
  date?: string;                     // existing — when the claim was recorded
  source?: string;                   // existing — kept as free-text fallback
  detail?: string;                   // existing
  origin?: ProvenanceOrigin;         // NEW
};
```

`origin` is the structured pointer. The four kinds cover the realistic capture surfaces:

- `commit` — the canonical case: "this fact came from observing `app/db.ts:42` at sha `abc123`."
- `message` — captured during a chat session (Slack thread id + message id, conversation transcript).
- `tool_call` — captured from a specific tool invocation that returned the fact (e.g. `kubectl get pods` output).
- `manual` — explicitly hand-entered with no machine-checkable source.

`origin` is optional so the migration is non-breaking. The CLI should populate it whenever the invocation context has the data: hooks know the tool/call ids; git-aware add commands can capture the current repo+sha automatically.

**Why both `source` and `origin`?** `source` stays for backwards compatibility and for cases where the operator legitimately wants prose ("standup with Anders, 2025-09"). New tooling SHOULD populate `origin` when possible, MUST NOT remove `source` if the user provided it.

## Storage layout

`KnowledgeEntry` is persisted in two places: JSONL files under `~/.mykb/areas/<id>/*.jsonl` and the SQLite mirror in `kb.db`. Both need the new fields.

### JSONL

Add fields to the per-line JSON object. Old lines without the new fields still parse. Loader applies defaults:

```ts
{
  validity: { valid_from: created, valid_until: undefined, superseded_by: undefined },
  trust: 'import',
  provenance: { ...existing, origin: undefined },
}
```

Defaulting legacy rows to `trust: 'import'` is conservative: it ensures pre-migration content is treated as not-operator-trusted by Tier-1 gating until reviewed (`kb verify` upgrades trust — see §Migration §3).

### SQLite

`src/core/db.ts` adds columns to the `entries` table:

```sql
ALTER TABLE entries ADD COLUMN validity_from TEXT NOT NULL DEFAULT '';
ALTER TABLE entries ADD COLUMN validity_until TEXT;
ALTER TABLE entries ADD COLUMN superseded_by TEXT;
ALTER TABLE entries ADD COLUMN trust TEXT NOT NULL DEFAULT 'import';
ALTER TABLE entries ADD COLUMN prov_origin_json TEXT;
CREATE INDEX idx_entries_trust ON entries(trust);
CREATE INDEX idx_entries_validity_until ON entries(validity_until) WHERE validity_until IS NOT NULL;
```

`prov_origin_json` stores the `ProvenanceOrigin` discriminated union as JSON; expanding it into typed columns adds three nullable columns per kind for marginal query benefit.

The schema bump is recorded in `meta.schema_version` (incremented from current value) so `kb rebuild` knows to refuse rebuilding into an older binary.

## Migration

Three phases, each independently shippable:

1. **Schema landing.** Add columns + JSONL fields. All writes populate them. All reads tolerate absence. `kb rebuild` re-derives the SQLite mirror from JSONL with defaults applied to legacy rows. No behavior change for retrieval — `trust` and `validity` are stored but not yet consulted.
2. **Trust gating.** Scorer reads `trust` and applies Tier-1 demotion. `kb verify <area> <id>` upgrades `trust` from `agent`/`import` to `operator` (this is the explicit human-review signal). Existing operator workflows continue uninterrupted; only Tier-1 injection of unverified content is blocked.
3. **Validity gating.** Default loaders filter `valid_until < today` and `superseded_by IS NOT NULL` out of results unless `--include-superseded` is passed. `kb load` learns `--include-historical` for retrospective queries.

`kb update` learns `--valid-until <date>`, `--supersede-with <id>`, `--trust <level>` (operator-only). The supersede flag updates both entries atomically: B gains a forward link, A gains `superseded_by=B.id`.

## Backwards compatibility

- Old JSONL rows load. Old kb.db files prompt a one-time `kb rebuild` (the schema-version mismatch path already exists for prior migrations).
- The `Provenance` type stays structurally compatible: callers reading `entry.provenance.source` continue to work.
- All new fields have defaults that produce conservative behavior (legacy rows are treated as not-trusted, currently-valid).

## Open questions

- **Legacy `valid_from` precision.** Backfilling to `created` is correct in spirit — we're saying "we recorded this on date X, treat that as the start of validity." But for entries migrated from OSB the `created` date is the OSB import date, not the original capture date. Decide whether to expose a `--valid-from-override` on `kb update` or accept the imprecision.
- **Operator trust scope.** Does `trust=operator` mean "this human authored it" or "this human reviewed it"? Treating `kb verify` as the trust-upgrade signal conflates the two. The cleaner model would be a separate `reviewed_by` field, but that doubles the schema complexity; defer to a v3.
- **Origin completeness for chat captures.** `kind: 'message'` requires a thread+message id. Claude Code does not expose stable message ids today. Either we accept the field as best-effort, or we wait until the harness exposes it. Recommend: ship with the field and let it be undefined when unavailable.
