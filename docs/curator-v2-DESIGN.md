# Curator v2 — ACE Delta Updates, Procedural Memory, Opus 4.6 Audit

> Status: design — implements §16 commitments 2, 6, 10 from `v2-harness-memory-RESEARCH.md`.
> Companion docs: `envelope-v2-DESIGN.md`, `curator-agent-DEFINITION.md`.

## Problem

The current curator (`docs/curator-agent-DEFINITION.md`) operates as a *consolidator*: it loads a whole area, classifies it into one of four profiles (A–D), and rewrites entries through `kb update` / `kb archive`. Three issues now matter for v2:

1. **Whole-area rewrites are expensive and lossy.** Each curation pass re-reads everything, decides what to merge, and produces a single bundle of changes. Drift between consecutive passes is invisible — the curator cannot say "since my last pass, fact A turned out to be wrong because it produced a bad recommendation in workspace W." ACE (ICLR 2026, §2 of the research brief) shows that maintaining a per-entry **delta log** with `helpful_count` and `harmful_count` outperforms whole-area rewrites for compositional context engineering.
2. **Patterns are extracted with the same prompt as facts.** The current curator treats every entry type uniformly. mem0 (§8) shows that procedural memory (sequences, conditional steps, cause-effect) needs different extraction signals from declarative memory (point-in-time claims). Patterns are how the LLM learns *how to do things in this codebase*; they deserve their own prompt and their own retrieval weighting.
3. **Defenses are calibrated for older models.** Pieces of the curator (truncation, fallback paths, redundant validation) were written when Sonnet 3.5 / Opus 3 was the assumed model. Opus 4.6 (and the Opus 4.7 1M-context variant we're now running) will likely tolerate looser defenses; over-engineering against a weaker model is dead weight in v2.

## Current state

Curator runs as a Claude Code subagent. Inputs: `kb load <area> --json`, `kb stats`, `kb search`. Outputs: `kb update`, `kb archive`, `kb add pattern`. The agent has no memory of prior passes; each invocation rebuilds the area picture from scratch.

The 14-point checklist (curator-agent-DEFINITION.md §"14-Point Curation Checklist") is comprehensive but uniform across entry types. Pattern extraction is implicit ("consolidate 3+ related entries into a pattern") rather than driven by a structurally different prompt.

## Proposed design

Three changes, each independently shippable.

### 1. ACE delta semantics (commitment 2)

Two new fields on the entry envelope (added by `envelope-v2-DESIGN.md`'s schema bump, but conceptually owned by the curator):

```ts
export type KnowledgeEntry = {
  // ... v2 fields ...
  helpful_count: number;   // default 0
  harmful_count: number;   // default 0
};
```

These are evidence counters. They are written by **outcome signals**, not by the curator directly:

- **Helpful signal sources.** When a Tier-1 entry was loaded into context for a session that the user closed with a satisfaction marker (e.g. `kb work checkpoint` succeeded, no `kb update --text` rewrites of that entry's content, no `kb archive` of the entry within N days). Increment by 1 per session loaded.
- **Harmful signal sources.** When the user explicitly invalidates the entry (`kb update --text`, `kb archive`, supersedes via the new `--supersede-with` flag) within N days of a session that loaded it. Increment by 1.

The curator's role becomes:

| Old role                        | New role                                                          |
|---------------------------------|-------------------------------------------------------------------|
| Decide what to merge            | Read deltas; act on entries with `harmful_count >> helpful_count` |
| Whole-area rewrites             | Targeted ops on outliers in the delta log                         |
| Single mega-pass per invocation | Many small passes; each touches O(few) entries                    |

This matches ACE's "modular delta updates" instead of monolithic context rewrites. The curator no longer asks *"what is the right shape for this whole area?"* — it asks *"which entries are paying for themselves and which are not?"*

The 14-point checklist still applies; it becomes the playbook the curator runs **on each flagged entry**, not on every entry.

`kb stats` learns `--by-trust` and `--harmful` flags so operators can audit the delta log directly. `kb show <area> <id>` exposes the counters in the rendered envelope.

### 2. Procedural memory as a first-class type (commitment 6)

`PatternEntry` already exists in `src/core/types.ts:60`. v2 changes how patterns are *extracted* and *retrieved*, not the type itself.

**Extraction.** The curator gets a dedicated prompt for pattern synthesis. Inputs:

- A cluster of related entries (facts + gotchas + decisions) about the same operational topic.
- The harmful-count subset of that cluster (entries that produced bad outcomes).
- The repo state at a stable sha (so the pattern can reference real file:line locations).

Output: a single `PatternEntry` whose text is structured as:

```
When <trigger condition>:
  1. <step>
  2. <step>
Why: <cause-effect, citing the specific gotchas this pattern avoids>
Verify: <how to confirm the pattern was applied correctly>
```

This is procedural shape — *trigger → steps → why → verification* — not a flat fact. The curator's pattern-extraction prompt explicitly forbids producing flat declarative content; if the cluster has no procedural structure, the output is `kb update` of existing facts, not a new pattern.

**Retrieval weighting.** In `src/extension/scorer.ts`, patterns get a Tier-2 boost over facts when:

- The signal source is a **file path** (procedural patterns are often "how to edit X").
- The signal contains imperative verbs ("install", "deploy", "rollback", "reset") — heuristic, configurable.

Currently `scoreAreas` scores areas, not entries. The boost lands one level down, in `selectEntriesForInjection` (`scorer.ts:134`): once an area is selected, patterns within it get weight `pattern_weight=1.5` over facts (`fact_weight=1.0`) when the signal heuristics fire. Default weights are conservative; the actual values are tuned via the audit in §3.

### 3. Re-audit against Opus 4.6 (commitment 10)

This is a one-time scoped audit, run before v2 scope locks. Deliverables:

- **Inventory of defensive code in the curator and scorer.** Identify truncation, redundant validation, fallback paths, retry loops, hard-coded prompt constraints. Each item gets a one-line "why this exists" annotation derived from git blame + linked decision (if any).
- **Per-defense decision.** Three buckets: keep (still needed against Opus 4.6 failure modes), relax (loosen threshold), remove (unnecessary against Opus 4.6).
- **A/B run on a frozen test corpus.** Pick 5 areas with diverse profiles (one each of A, B, C, D from the curator-agent-DEFINITION classification, plus one workspace-linked area). Run curator with current defenses and with proposed-relaxed defenses against the same input. Diff the outputs by entry-id-level changes.

Audit lives in a new doc, `docs/curator-opus-audit-REPORT.md`, written when the audit runs. It is not a design doc; it is a one-shot audit output. Its findings feed back as `kb update` calls on the curator definition (`docs/curator-agent-DEFINITION.md`) and on this file.

The audit blocks v2 lock-down. We do not commit to specific weight values for §2 (helpful/harmful thresholds) or §1 (pattern boost) until the audit produces measurements.

## Storage and CLI

No new storage beyond `envelope-v2-DESIGN.md`'s schema bump (counters land on the entry envelope).

CLI additions:

```
kb stats --by-trust            # entry counts grouped by trust level
kb stats --harmful              # entries with harmful_count > helpful_count
kb show <area> <id>             # render full envelope incl. counters and validity
kb update <area> <id> --supersede-with <other-id>   # see envelope-v2-DESIGN.md
```

Counter writes happen in two places:

- `src/extension/hooks/context.ts` — at session load, record which entries were injected (write to a session log under `~/.mykb/sessions/<id>.json`).
- `src/cli/cli.ts` — at session close (or at the next `kb update`/`kb archive` of an entry), reconcile against the session log: increment `helpful_count` for entries loaded but not edited within N days; increment `harmful_count` for entries edited or archived within N days of being loaded.

Reconciliation is idempotent (each session is processed once, marked in `meta`), so a missed reconciliation just delays the increment without double-counting.

## Migration

1. **Counters land at zero.** All existing entries get `helpful_count=0`, `harmful_count=0`. The curator does not act on counters until they have data.
2. **Session logging starts.** The hook writes session injection logs but the reconciliation pass is idempotent and noop-safe; it can run in dry-run mode for a release before counters start updating.
3. **Pattern-extraction prompt swap.** Update the curator subagent definition (`~/.claude/agents/curator.md` per `curator-agent-DEFINITION.md`) to use the new pattern prompt. Old patterns are not retroactively rewritten; they coexist with v2 patterns until the curator visits their cluster naturally.
4. **Audit runs.** Defaults stay conservative until the audit produces tuned values.

Each phase is independently revertable.

## Backwards compatibility

- Areas curated before v2 continue to work; their entries simply have `helpful_count=harmful_count=0` until reconciliation runs.
- The 14-point checklist is unchanged.
- Existing pattern entries are still valid; the structural-text guidance is forward-looking, not enforced retroactively.

## Open questions

- **Reconciliation window N.** The "within N days" for harmful/helpful attribution is unbounded above (7 days? 30 days?). Too short under-counts harm signals (the user may not realize a fact was bad until weeks later); too long muddies attribution. Recommend 14 days, revisit after the audit. Configurable in `~/.mykb/config.json`.
- **Tier-2 boost values for patterns.** §2's `pattern_weight=1.5` is a placeholder. The audit (§3) is the data source for the real value.
- **Curator runs autonomously vs. on demand.** Currently the curator is operator-invoked. ACE deltas could justify a scheduled background run (`kb curate --auto`) once counters have signal. Defer to v2.5 — autonomous curator writes are exactly the supply-chain risk the trust gating in `envelope-v2-DESIGN.md` is meant to bound, so we want the trust system stable first.
- **What happens to harmful_count after the entry is archived?** Counter resets? Carries through `superseded_by`? Recommend: counters freeze at archive time and copy forward to `superseded_by` so a chain of bad entries accumulates evidence rather than resetting per supersession.
