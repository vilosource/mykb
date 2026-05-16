# v2 Roadmap — Prioritized Implementation Plan

> Status: plan — derived from the 5 v2 DESIGN docs and §16 of `v2-harness-memory-RESEARCH.md`.
> Companions: `envelope-v2-DESIGN.md`, `curator-v2-DESIGN.md`, `two-stage-retrieval-DESIGN.md`, `standards-export-DESIGN.md`, `journal-auto-inject-DESIGN.md`.

## Purpose

`v2-harness-memory-RESEARCH.md` §16 commits to 10 architectural changes. The 5 DESIGN docs spell each one out. This document ranks them by **usefulness** (what the user feels per session) and by **priority** (what to actually build first, given dependencies and effort), and identifies what to defer or cut.

Two rankings, because they diverge:

- **Usefulness** = direct impact on session quality if magic delivered the feature today.
- **Priority** = usefulness × effort × what unblocks what.

## Usefulness ranking (impact-only)

Pure impact, ignoring cost and dependencies — what would change about a typical session if this commitment shipped tomorrow.

| Rank | Commitment | Why this rank |
|------|------------|---------------|
| 1 | **#7 Auto-inject recent journal** | Every session immediately gets continuity context the LLM cannot see today. The pi-mem worked counter-example shows recency injection dominates "feels like it has memory" — beats systems with sophisticated curation but no recency. Touches every session. |
| 2 | **#5 Two-stage retrieval (BM25 + rerank)** | Current retrieval saturates the token budget with load-order entries from the selected area. As areas grow (hetzner is already 50+ entries), per-session relevance is mostly luck. BM25 candidate selection is a step-function quality lift. |
| 3 | **#3 Bi-temporal validity** | Stale facts mislead the LLM today. `valid_until` + `superseded_by` makes invalidation explicit and auditable instead of relying on the operator remembering to archive. |
| 4 | **#8 Trust level per entry** | Latent-then-acute. Today the curator is operator-supervised, so the security risk is theoretical. The moment the curator runs autonomously (which #2's ACE counters argue for), agent-poisoned entries can land in Tier-1. Must be in place *before* curator autonomy. |
| 5 | **#10 Re-audit curator/scorer against Opus 4.6** | Smaller scope, high yield. Current curator/scorer carry defenses calibrated for weaker models; on Opus 4.6 / 4.7-1M most are dead weight. Removing dead defenses is the cheapest quality lift in the list. |
| 6 | **#6 Procedural memory (pattern extraction)** | Patterns are how the LLM learns "how to do things in this codebase." Better extraction → better procedural recall on every multi-step task. Compounds slowly, durably. |
| 7 | **#2 ACE delta updates** | High strategic value, slow time-to-value. Counters need weeks of data before the curator can act on them. Worth instrumenting early so data accumulates passively. |
| 8 | **#9 Structured provenance** | Questionable for a solo operator. Free-text `source` works. Audit story is compelling for multi-author KBs; mykb is single-author. The lowest-value envelope change. |
| 9 | **#4 Standards exports (AGENTS.md + Skills)** | Zero immediate value on Claude Code. Strategic insurance against harness lock-in. Value materializes the day a non-Claude harness opens a kb-linked repo. |
| 10 | **#1 No MCP server** | Already a decision. No code work; just discipline. Useful as a constraint that simplifies every other design. |

## Priority ranking (what to build first)

Each commitment splits into shippable slices; some slices ship at very different priorities than others (envelope-v2 phase 1 is invisible foundation; phase 3 is a correctness win — same doc, opposite urgency).

Ordered by usefulness × tractability × unblocks-what:

| Order | Slice | Effort | Rationale |
|-------|-------|--------|-----------|
| 1 | **#7 journal-auto-inject** (full) | ~1 day | Highest usefulness, smallest effort, zero dependencies. No reason to wait. |
| 2 | **envelope-v2 phase 1** — schema bump only | ~2–3 days | Invisible to the user. Unblocks #2 counters, #3 validity, #5 heuristic rerank, #8 trust gate, #4 trust-gated export. Bottleneck for everything below. |
| 3 | **#5 two-stage retrieval Stage 1** — BM25 candidates + NoopReranker default | ~2–3 days | Independent of envelope-v2; ship in parallel with #2 if bandwidth allows. Direct visible quality lift. |
| 4 | **#10 Opus 4.6 re-audit** | ~1 day | Standalone, no dependencies. Calibrates thresholds for everything in tier 5+. Can run concurrently with #2/#3. |
| 5 | **envelope-v2 phase 3** — validity gating in default loaders | ~1–2 days | Direct correctness win. Phase 1 paid the migration cost; this just turns on the filter. |
| 6 | **envelope-v2 phase 2** — trust gating in scorer / Tier-1 demote | ~1–2 days | Security guard. Must be in before tier 9 (autonomous curator). Cheap once phase 1 is in. |
| 7 | **#5 two-stage Stage 2 heuristic** — flip HeuristicReranker default | ~1 day | Trust + validity from envelope-v2 plug into the rerank. Compounds with Stage 1. |
| 8 | **#6 procedural pattern prompt** — curator definition update | hours | Cheap. Better patterns from every future curation pass. |
| 9 | **#2 counter instrumentation** — hook session log + CLI reconciliation | ~2 days | Plumbing only. Counters write to the envelope (needs phase 1); no curator behavior change yet. Data accumulates passively. |
| 10 | **#2 ACE-driven curation** — curator acts on counters | curator prompt rewrite + audit | Months after #9; only meaningful with accumulated data. Trust gate (tier 6) must be in first. |
| 11 | **#9 structured provenance** — populate `origin` across CLI paths | ongoing | Schema bundled into phase 1 cheaply; populating `origin` is ongoing work I'd skip until someone needs the audit story. |
| 12 | **#4 standards-export AGENTS.md** | ~3 days | Build when the first non-Claude-Code use case appears. |
| 13 | **#4 standards-export Agent Skills** | ~3 days | Same, even later (skill packaging conventions still evolving). |
| — | **#5 EmbeddingReranker (opt-in)** | ~3 days | Honestly may never earn its keep. BM25 + heuristic is strong on operational technical text. Defer indefinitely. |

## Deferrals and cuts

Three places to push back on the original §16 list:

1. **Demote #9 (structured provenance).** The motivation is auditability, but mykb is single-author. Free-text `source` already works. Bundle the schema column into phase 1 (cheap), but don't invest in populating `origin` across the CLI. Reconsider when a multi-author scenario emerges.

2. **Defer #4 (standards exports) until a second harness is in use.** Building exporters today optimizes for a future you may never inhabit. Maintenance cost is real (AGENTS.md schema drift, Skills layout shifts). YAGNI argues "ship when needed."

3. **Skip EmbeddingReranker.** BM25 + heuristic handles technical operational text well. Embedding rerank shines on natural-language semantic gaps that aren't mykb's failure mode. The local-model + sidecar table + cache invalidation overhead is too much insurance for too little expected gain.

## "If you only ship 3 things this quarter"

1. **#7 journal-auto-inject** — biggest per-day-of-work win in the list.
2. **#5 two-stage retrieval Stage 1 (BM25)** — fixes the silent retrieval-quality decay as areas grow.
3. **envelope-v2 phase 1 + phase 3** — schema bump plus turn on validity filtering, in one push, so stale facts stop loading.

Trust gating (envelope-v2 phase 2) and the Opus audit (#10) are the strong tier-2 picks once those land. Everything else is tier-3 or defer-indefinitely.

## Dependency graph

```
                      ┌──────────────────────────┐
                      │ envelope-v2 phase 1      │
                      │ (schema bump, no behavior)│
                      └──────────────────────────┘
                       │     │       │       │
              ┌────────┘     │       │       └────────┐
              ▼              ▼       ▼                ▼
   ┌──────────────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐
   │ envelope-v2 ph.2 │ │ envelope │ │ #2       │ │ standards-   │
   │ (trust gate)     │ │ phase 3  │ │ counter  │ │ export       │
   │                  │ │ (validity│ │ instrum.│ │ (trust-gated)│
   └──────────────────┘ └──────────┘ └──────────┘ └──────────────┘
              │              │           │
              ▼              │           ▼
   ┌──────────────────┐      │   ┌──────────────────┐
   │ #4 standards-    │      │   │ #2 ACE-driven    │
   │ export (safe)    │      │   │ curation         │
   └──────────────────┘      │   └──────────────────┘
                             ▼
                      ┌──────────────┐
                      │ #5 two-stage │
                      │ Stage 2      │
                      │ heuristic    │
                      └──────────────┘

  Independent (no deps):
   - #7 journal-auto-inject
   - #5 two-stage Stage 1 (BM25 + NoopReranker)
   - #6 procedural pattern prompt
   - #10 Opus 4.6 re-audit
```

## Open questions on this plan

- **Does Opus audit (#10) precede or follow envelope-v2 phase 2?** §10 may recommend dropping defenses that the trust gate's design assumes are present. If the audit lands first and the gate's defaults follow its findings, we save churn. Recommend audit first.
- **Should counter instrumentation (priority 9) ship simultaneously with phase 1?** Bundled, both touch the hook and the schema. Splitting them is cleaner from a review/revert standpoint; bundling saves a release cycle. Lean toward splitting.
- **What triggers a re-prioritization?** Three triggers: (a) you start using a non-Claude-Code harness — promotes #4; (b) you experience a stale-fact-induced incident — promotes envelope-v2 phase 3; (c) the curator runs autonomously for the first time — hard-requires envelope-v2 phase 2 to be in.

## Companion artifacts

- The 10 §16 commitments are kb decisions on the `mykb` area: `3qKsbCaa, DgGXpZK2, Nz3n3NbK, GSBSaPPN, JbwcAtff, 15WeqOL8, yFFFgAeK, z31OhiKd, gdzsobDb, DCrczpJy`.
- This roadmap should be added as a kb decision on `mykb` so future sessions surface it on `kb load mykb`.
