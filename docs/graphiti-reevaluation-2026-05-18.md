# Graphiti Re-evaluation — 2026-05-18

> Status: evaluation. Revisits `v2-harness-memory-RESEARCH.md` §3 and `envelope-v2-DESIGN.md`
> with Graphiti's *current* state, per an explicit "is Graphiti of any use/improvement for mykb"
> request. All claims below verified by fetching getzep/graphiti on 2026-05-18, not from the
> 10-day-old brief.

## Verified current state (graphiti-core v0.29.0, 2026-04-27, Apache-2.0)

- **Mandatory graph DB backend**: Neo4j / FalkorDB / Kuzu / Neptune. Cannot run without one.
- **LLM + structured output required on every ingest** to extract entities and edges.
- **True 2×2 bitemporal model**: event time (`valid_at`, `invalid_at`) and system time
  (`created_at`, `expired_at`) tracked independently per fact.
- Episodes = immutable ground-truth ingest stream; every derived fact has full lineage back to it.
- Hybrid retrieval: BM25 + semantic embeddings + graph traversal + cross-encoder rerank.
- No community detection / summarization (the brief's "no" still holds).

## Conclusions

### 1. Do NOT adopt Graphiti as a dependency — stronger reason than the brief gave

Graphiti mandates (a) a graph database and (b) an LLM call on every write. mykb v2's
load-bearing commitments are the inverse: no network surface (commitment #1), files + SQLite
source of truth, deterministic no-LLM-on-write. Adopting Graphiti-the-system means discarding
mykb's identity. The 2026-05-08 brief's instinct to mine only the *temporal pattern* was
correct; this re-eval confirms it on architecture grounds, not just security.

The entity/relationship graph layer is also correctly dropped: `links` + `kb match` already
cover "what connects area A and area B" without an LLM entity-extractor on the write path.

### 2. One concrete refinement the brief missed: mykb lacks a system-time END

`envelope-v2-DESIGN.md` §1 asserts mykb's existing `created`/`updated` "gives the system-time
pair." Verified false: `updated` is rewritten on *any* mutation (`knowledge-store.ts:191`),
including tag-only edits. So mykb has ~1.5 of Graphiti's 4 temporal dimensions:

| Graphiti | mykb today | mykb envelope-v2 (designed) |
|---|---|---|
| `valid_at` (event start) | — | `validity.valid_from` ✅ |
| `invalid_at` (event end) | — | `validity.valid_until` ✅ |
| `created_at` (system start) | `created` ✅ | `created` ✅ |
| `expired_at` (system end / logical version close) | **missing** (`updated` ≠ this) | **still missing** |

`expired_at` answers "when did *we* record that this fact stopped being true" — distinct
from `valid_until` ("when did it actually stop"). For an operator KB this is the audit
question *"what did we believe about postnord on 2026-03-01?"*, answerable only with a
system-time end, not last-touch time.

**Recommended additive change to envelope-v2 phase 1**: add `validity.recorded_invalid_at?:
string` (system-time when supersession/invalidation was recorded). Set atomically alongside
`superseded_by` / `valid_until`. Purely additive, defaults `undefined`, no migration cost
beyond the column already planned. Correct the §1 prose claim that `created`/`updated` is the
system-time pair — it is not.

### 3. Corroboration only (no new action)

Graphiti's BM25 + semantic + cross-encoder rerank independently validates roadmap #5
two-stage retrieval. It does **not** change the call to defer EmbeddingReranker: Graphiti
needs a reranker over noisy graph-traversal output; mykb's BM25 over curated operational
text is a different failure profile.

## Net

Graphiti remains *useful as a reference, not as a component*. The brief extracted the right
slice. The single net-new improvement is the missing system-time end (`expired_at`
equivalent) — a small additive field for envelope-v2 phase 1, not a new workstream.
