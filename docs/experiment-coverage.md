# Experiment coverage

> **Purpose:** central index of every Layer-4 matrix in this repo plus the gaps where features ship without an L4 anchor. Read this before declaring "all experiments done." The list is **never** finished — new features should land with their matrix and update this index.
>
> **Companion:** [`findings-log.md`](findings-log.md) — every latent production bug AND methodology gotcha surfaced while building these matrices. Read both when assessing mykb's correctness state.

## Implemented matrices

These ship with full `EXPERIMENT.md` + at least one `scenarios/*.sh` and have been RED→GREEN-proven against a real Pi runtime.

| Feature | Matrix | Scenarios | Status |
|---|---|---|---|
| `kb work handoff` | [`experiments/handoff/`](../experiments/handoff/) | continuity, overwrite, clear, no-active-workspace | ✅ implemented — `<mykb-workspace>`-not-visible regression ([issue #5](https://github.com/vilosource/mykb/issues/5)) fixed in commit `ab2c22b`; `continuity` re-verified GREEN post-fix |
| Per-turn journal injection | [`experiments/journal-auto-inject/`](../experiments/journal-auto-inject/) | resume-continuity, stale-filter, mid-session-append, no-active-workspace | ✅ implemented — same regression fixed (`ab2c22b`); `resume-continuity` re-verified GREEN post-fix |
| Area scoring (v1 + v2 + v3) | [`experiments/area-scoring/`](../experiments/area-scoring/) | keyword-match-loads, off-topic-no-leak, no-workspace-still-loads, init-area-tags, kb-list-shows-tags, scoring-without-tools, scoring-isolated, file-path-signal, workspace-boost, sticky-area-persistence, token-budget-eviction | ✅ implemented (full matrix — all 11 rows) |
| `kb_search` tool + FTS area-metadata | [`experiments/kb-search/`](../experiments/kb-search/) | tool-direct-text-match, tool-finds-via-area-metadata, tool-no-match-no-fabrication | ✅ implemented |
| `kb_load` tool contract | [`experiments/kb-load/`](../experiments/kb-load/) | basic-load, discover-via-area-index, unknown-area-no-fabrication | ✅ implemented |
| `kb_list` tool contract | [`experiments/kb-list/`](../experiments/kb-list/) | basic-list, lists-tags-suffix, no-match-no-fabrication | ✅ implemented |
| `kb work checkpoint` (LLM-as-extractor) | [`experiments/work-checkpoint/`](../experiments/work-checkpoint/) | journal-extraction, knowledge-extraction, empty-conversation-no-fabrication | ✅ implemented |
| Claude Code runtime | [`experiments/claude-code/`](../experiments/claude-code/) | bare-runs, hook-injects-handoff | ✅ implemented |
| `tool-gating` hook | [`experiments/tool-gating/`](../experiments/tool-gating/) | blocks-write-to-brain, blocks-edit-by-pattern, allows-non-knowledge-writes, block-then-retry-via-kb-add, bash-bypass-known-gap | ✅ implemented (one known-fail documenting a security gap — see matrix) |
| `kb_work_*` tools (journal, state, note) | [`experiments/kb-work-tools/`](../experiments/kb-work-tools/) | journal-tool, state-tool, note-tool, no-active-workspace | ✅ implemented — the streaming workspace-mutation path (per-tool); `state-tool` is the cross-step `<mykb-workspace>` re-injection anchor |

**Total: 10 matrices, 42 scenarios** (including 1 documented known-fail).

## Scaffolded matrices (not-yet-implemented)

Each has an `EXPERIMENT.md` with intent + behavior matrix but no `scenarios/*.sh` yet. The methodology requires every Layer-4 feature to have at least one scenario; these are **violations of that rule** that will be closed by future cycles.

| Feature | Matrix | Why it needs L4 |
|---|---|---|
| `kb_add` tool | [`experiments/kb-add/`](../experiments/kb-add/) | LLM-callable tool to add facts/decisions/gotchas/patterns to an area. The "LLM mutates the brain" path. Currently L1-only. |
| `kb_verify` tool | [`experiments/kb-verify/`](../experiments/kb-verify/) | LLM marks an entry as verified (provenance ratchet). Important for the trust-decay model. Currently L1-only. |
| `/kb` slash command | [`experiments/kb-command/`](../experiments/kb-command/) | On-demand area loading via Pi's slash-command surface. Currently L1-only. |

## Sub-behavior gaps in implemented matrices

These belong to existing matrices but the matrix's behavior table flags them as not-yet-covered.

| Matrix | Gap | Notes |
|---|---|---|
| `area-scoring` | Sticky-area persistence across turns | An area loaded in turn N gets a sticky-boost in turn N+1. Scenario attempted; **blocked** — [issue #6](https://github.com/vilosource/mykb/issues/6). |
| `area-scoring` | Token-budget eviction order | When the 2000-token budget is exceeded, which areas keep their entries? Highest-scoring — `selectEntriesForInjection` now has a deterministic area-id tie-break, but the end-to-end scenario is **blocked** on the same investigation ([issue #6](https://github.com/vilosource/mykb/issues/6)). |

## Cross-cutting properties without an L4 home

- **Compaction interaction:** when Pi auto-compacts a long session, does the kb extension survive? Specifically: do persisted signals / loaded-areas survive the compaction event? No scenario.
- **Multi-turn injection coherence:** turn N injects area A; turn N+1 injects area B. Does the LLM see both, just B, or get confused? No scenario.
- **Concurrent session contention:** two `KB_SESSION_ID`s writing to the same workspace. Atomicity is L1-tested for individual operations; the multi-process pattern at L4 isn't.

## Maintenance

- **Adding a feature**: ship its matrix at the same time. Add a row to the **Implemented matrices** table.
- **Closing a scaffold**: implement scenarios; move the row from **Scaffolded** to **Implemented**. Delete from **Sub-behavior gaps** if it covered one.
- **Discovering a gap**: add a row to **Scaffolded matrices** AND scaffold an `EXPERIMENT.md` so the doc stays linkable.

## Why this doc exists

The methodology says experiments accumulate as the regression suite. That's correct as a steady-state goal; in practice, **shipping an L4 matrix lags shipping the feature**. Without an explicit gap list, "feature X has no L4" silently fades from collective awareness — until a scenario surfaces a latent bug (cycle 8 was the load-bearing example: 3-layer context-event bug latent for the entire history of mykb because every prior matrix had a fallback path that masked it).

Tracking gaps is cheap. The cost of a gap that goes unnoticed for months is high.
