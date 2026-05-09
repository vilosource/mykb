# Two-Stage Retrieval — BM25 Candidate + Optional Rerank

> Status: design — implements §16 commitment 5 from `v2-harness-memory-RESEARCH.md`.
> Companion docs: `envelope-v2-DESIGN.md`, `curator-v2-DESIGN.md`.

## Problem

The current scorer (`src/extension/scorer.ts`) uses a single-stage word-overlap algorithm: tokenize the signal, count matches against each area's summary + tags, return ranked areas. Once an area is selected, all non-archived entries within it are dumped (subject to a token budget) in storage order.

This works for routing signals to areas but has two known failure modes:

1. **High-recall, low-precision area selection.** Word overlap reliably picks the right *area* when keywords match. But if the user asks about "the database connection pattern in stark", the scorer correctly routes to the `stark` area and then injects 50 entries — including 47 that are about other topics. The retrieval ceiling is set by the area, not by the query.
2. **No notion of within-area relevance.** `selectEntriesForInjection` (`scorer.ts:134`) iterates entries in load order until the token budget is hit. The order is whatever the JSONL store yielded; there is no per-entry score against the signal. A high-value pattern at line 200 of facts.jsonl loses to a tangentially-related fact at line 5.

mem0's State of Agent Memory 2026 (research brief §7) and production retrieval systems converge on the same fix: **two-stage retrieval**. Stage 1 produces a candidate set with cheap recall-oriented scoring (BM25 / keyword overlap). Stage 2 re-ranks the top-N candidates with a more expensive precision-oriented scorer (cross-encoder, embedding similarity, or LLM rerank).

## Current state

```ts
// src/extension/scorer.ts:93
export function scoreAreas(
  signals: Signal[],
  providers: SignalProvider[],
  areas: AreaMetadata[],
  _store: MykbStore,
  boostedAreas?: Set<string>,
): Map<string, number> {
  // Sums word-overlap scores from each provider; applies workspace boost.
}

// src/extension/scorer.ts:134
export function selectEntriesForInjection(
  scoredAreas: Map<string, number>,
  store: MykbStore,
  tokenBudget: number,
  loadedAreas: Set<string>,
): Map<string, KnowledgeEntry[]> {
  // For each top-scored area, dump entries until budget exhausted.
}
```

Note `_store` is already threaded through `scoreAreas` "reserved for future FTS5-based deep matching" (`scorer.ts:97`). v2 cashes that in.

## Proposed design

A two-stage pipeline at the entry level. Area scoring is unchanged; what changes is what happens *after* an area is selected.

### Stage 1 — BM25 candidate set

Replace "load all non-archived entries" with "FTS5-ranked candidates from the area." SQLite's FTS5 already exists in `kb.db` for the `kb search` command; the same index serves entry-level retrieval.

```ts
function selectAreaCandidates(
  area: string,
  signal: Signal,
  store: MykbStore,
  k: number,                 // candidate set size, default 30
): KnowledgeEntry[] {
  // Run FTS5 query: signal tokens AND area=<area> AND zone != 'archive'
  // Return top-k by BM25 rank.
}
```

`k` is the candidate set ceiling, **not** the injection ceiling. The token budget still bounds what reaches context. `k=30` is a starting point; cheap to compute (FTS5 returns this in microseconds for areas of any reasonable size) and large enough that stage 2 has room to re-rank.

Areas without enough FTS5 hits fall back to load-order (current behavior) — this keeps small or new areas working unchanged.

### Stage 2 — optional rerank

Above the candidate set, an optional reranker reorders entries by per-entry score. Pluggable via the existing `SignalProvider`-like interface:

```ts
export interface EntryReranker {
  name: string;
  rerank(signal: Signal, candidates: KnowledgeEntry[]): KnowledgeEntry[];
}
```

Three reranker implementations to ship in v2:

- **`NoopReranker`** — returns BM25 order unchanged. Default. Zero added latency.
- **`HeuristicReranker`** — applies the v2 envelope-aware adjustments locally (no model call): boost `trust=operator`, demote `valid_until < today`, demote `superseded_by != null`, apply the procedural-pattern boost from `curator-v2-DESIGN.md` §2. ~milliseconds for k=30.
- **`EmbeddingReranker`** (opt-in) — computes cosine similarity between signal embedding and entry embeddings (precomputed at write time, stored in a sidecar SQLite table `entry_embeddings`). ~10ms for k=30 with a local model. Off by default; enabled per `~/.mykb/config.json`.

A future LLM-rerank stage is plausible but explicitly out of scope for v2: it crosses the latency budget (hooks must complete in <500ms to feel native) and reintroduces the kind of model-version sensitivity the curator audit (`curator-v2-DESIGN.md` §3) is trying to remove from the always-on path.

### Wiring

```ts
// New entry-level scoring pipeline
export function selectEntriesForInjection(
  scoredAreas: Map<string, number>,
  signal: Signal,                     // NEW — the originating signal
  store: MykbStore,
  tokenBudget: number,
  loadedAreas: Set<string>,
  reranker: EntryReranker = new NoopReranker(),  // NEW — default preserves v1 behavior
): Map<string, KnowledgeEntry[]> {
  // For each top-scored area:
  //   candidates = selectAreaCandidates(area, signal, store, k=30)
  //   ranked = reranker.rerank(signal, candidates)
  //   inject ranked entries until token budget exhausted.
}
```

The signal that drove area selection is now passed through to entry selection. This is the missing piece in v1: area scoring used the signal, entry selection ignored it.

## Schema and storage

- **No new persistent fields** for stages 1 and 2 (NoopReranker, HeuristicReranker). The FTS5 index already exists.
- **Embedding sidecar (opt-in only).** A new SQLite table for the `EmbeddingReranker`:

```sql
CREATE TABLE IF NOT EXISTS entry_embeddings (
  entry_id TEXT PRIMARY KEY,
  area TEXT NOT NULL,
  model TEXT NOT NULL,
  dims INTEGER NOT NULL,
  vector BLOB NOT NULL,
  updated TEXT NOT NULL,
  FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE
);
```

Embeddings are computed lazily: when the `EmbeddingReranker` is enabled and encounters an entry without an embedding, it computes and caches one. There is no upfront migration cost.

The embedding model is configurable in `~/.mykb/config.json`. Switching models invalidates cached embeddings (compared via the `model` column).

## Configuration

`~/.mykb/config.json` learns:

```json
{
  "retrieval": {
    "candidate_k": 30,
    "reranker": "heuristic",
    "embedding_model": "all-MiniLM-L6-v2",
    "embedding_endpoint": null
  }
}
```

Defaults: `candidate_k=30`, `reranker="heuristic"`. Embedding settings are only consulted when `reranker="embedding"`.

## Migration

1. **Stage 1 lands.** `selectAreaCandidates` replaces the load-order entry pull. NoopReranker is default. Existing behavior preserved for areas with no FTS5 hits.
2. **HeuristicReranker becomes default.** Once `envelope-v2-DESIGN.md` ships (trust/validity fields populated), flip the default reranker. Pure local computation; no new dependencies.
3. **EmbeddingReranker available.** Lazy-cache table created on first opt-in. No effect for users who don't enable it.

## Backwards compatibility

- The v1 `scoreAreas` signature is preserved exactly.
- `selectEntriesForInjection` adds `signal` and `reranker` params; existing callers updated. The function is internal to `src/extension/`; no public API break.
- Areas with no FTS5 matches fall back to load-order — small / new areas are unaffected.

## Open questions

- **Candidate `k` size.** 30 is a starting point. Too low under-recalls; too high makes the reranker work harder for no precision gain. The audit in `curator-v2-DESIGN.md` §3 should produce a recommended `k` against the same A/B corpus.
- **FTS5 query construction.** Signal tokens combine with `OR` for recall, with the FTS5 ranking function doing the work. We should confirm the index already includes `tags` and `text`; it does (`docs/storage-format-RESEARCH.md` shows the existing schema). Whether to also index `provenance.detail` is open — leans no, it's metadata not knowledge.
- **Reranker latency budget.** Hook-injected context loads on every prompt submission. NoopReranker and HeuristicReranker are well inside 500ms even for k=30 across 5 areas (~150 entries reranked). EmbeddingReranker depends on the embedding endpoint — local model OK, remote API call is not.
- **Cross-area rerank.** Currently we score areas, then rank entries within each area, then concatenate. A future v2.5 could pool candidates across areas and rank globally. Deferred — area-grouping in the rendered output is a feature, not an artifact of the algorithm.
