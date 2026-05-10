# Journal Auto-Injection — Recent Workspace Journal at Session Start

> Status: design — implements §16 commitment 7 from `v2-harness-memory-RESEARCH.md`.
> Companion docs: `workspace-cold-start-ANALYSIS.md`, `workspaces-DESIGN.md`, `checkpoint-feature-DESIGN.md`.
>
> **Correction note (2026-05-09):** the original draft of this design said the
> implementation hook is `src/extension/hooks/context.ts` (the per-turn context
> hook). That was wrong. A first attempt that landed there was reverted and
> re-implemented in `src/extension/hooks/session.ts`'s `before_agent_start`
> handler. See §"Hook integration" for the full reasoning; the short version
> is that Pi runs `before_agent_start` on every user prompt and sets the
> system prompt with `cache_control: ephemeral`, so a stable system-prompt
> injection costs ~10% of full input on cached turns, while the per-turn
> context-hook path inserts a varying system message into the messages array
> and invalidates the conversation cache on every fire.

## Problem

The current workspace cold-start surfaces two pieces of session-continuity content when the user runs `kb work start <id>`:

1. The **handoff** — a single-overwrite text describing what's in flight and what's next.
2. The **journal** — append-only milestone log, read on demand via `kb work journal --show N`.

Handoff handles the "where did we leave off" case well. The journal, in contrast, has been auto-injected only as the **last 3 entries** (per `workspaces-DESIGN.md` §"What you DO get at session start"). For long-running workspaces with sparse activity, last-3 is too narrow — entries from a week ago surface alongside today's, and the LLM cannot tell which are still operationally relevant.

pi-mem (research brief §10) is the worked counter-example: a memory system that does almost nothing right by mykb's standards (no curation, no zones, flat append-only) but injects recent journal content on a date window into every session and produces noticeably better continuity than systems with sophisticated curation but no recency injection.

The conclusion in §16 commitment 7: **auto-inject the last N days of journal at session start**, default `N = 2`. Replace the entry-count cap with a date window plus a max-entries safety cap.

## Current state (before this change)

```ts
// src/extension/hooks/session.ts:50 (before)
const journalEntries = wsStorage.readJournal(activeId, 3);
const handoff = wsStorage.readHandoff(activeId);
const rendered = renderWorkspace(workspace, journalEntries, undefined, handoff);
```

The `before_agent_start` hook:

1. Reads the manifest and renders an `<mykb-areas>` block.
2. If a workspace is active, reads handoff + last 3 journal entries and renders an `<mykb-workspace>` block (which contains a `## Recent Journal` section inside it).
3. Appends both blocks to the system prompt.

Pi runs this hook on every user prompt and uses the returned `systemPrompt` via `agent.setSystemPrompt(...)`. The system prompt is sent to Anthropic with `cache_control: ephemeral`, so when the bytes are stable across turns the cache absorbs the cost.

Six other places in the codebase read journal with different caps:

| Caller                               | Cap            | Purpose                          |
|--------------------------------------|----------------|----------------------------------|
| `session.ts:50` (this file's target) | 3 → 2 days/20  | Hook auto-inject                 |
| `cli.ts:613` (`kb work start`)       | 3              | Operator terminal output         |
| `cli.ts:631` (`kb work stop`)        | unlimited      | Stale-handoff check              |
| `cli.ts:782` (`kb work journal --show`) | 5 (default)    | Operator-controlled              |
| `cli.ts:919` (`kb work` list)        | 5              | Workspace summary                |

This design only changes the first one. Unifying the others is deferred — each call site has a defensible per-context default.

## Proposed design

A small change with disproportionate impact. The hook auto-loads recent journal alongside the handoff and area knowledge it already injects.

### Scope

For the active workspace (resolved via `getActiveWorkspaceId` from `WorkspaceStorage`):

- Read the newest `M = 20` journal entries from disk.
- Filter to those with `date >= now - N days` where `N = 2`.
- Pass the filtered list to `renderWorkspace` (existing) — the `## Recent Journal` section in the `<mykb-workspace>` block already handles the rendering.

Defaults:

- `N = 2` days (yesterday and today).
- `M = 20` hard ceiling regardless of date window (defends against pathological journals where many entries land in one day).

### Why `before_agent_start`, not the per-turn `context` hook

Pi's hook lifecycle and Anthropic prompt caching together drive the placement decision:

1. **`before_agent_start` is per-turn but cache-friendly.** Pi calls `emitBeforeAgentStart` inside the per-prompt path (see `pi-coding-agent/dist/core/agent-session.js:719`), passing the base system prompt and assigning the returned value via `agent.setSystemPrompt(...)`. The returned prompt is sent with `cache_control: ephemeral` (`pi-ai/dist/providers/anthropic.js:493`). When the journal is stable across turns, the cache hits and the journal costs ~10% of full input. When the journal mutates (LLM appends an entry via `kb_work_journal`), the next turn pays a cache write — but only that one turn.

2. **The `context` hook invalidates more cache.** It inserts a `role: 'system'` message into the messages array (see `context.ts:114-123`), which sits inside the cached prefix boundary. Any signal-firing turn changes the bytes there, forcing the conversation history before that point to re-pay the cache write. In a 50-turn session with ~30 signal-firing turns, that is ~30 cache-write events vs. ~6 for the system-prompt path.

3. **Both paths are equally fresh.** `before_agent_start` re-reads the journal on every turn — it is not "frozen at session start" as I initially assumed. So the freshness argument that originally pushed me toward the context hook does not actually hold.

4. **Semantic fit.** Journal is ambient background memory ("what has been happening here"), not signal-triggered retrieval ("what knowledge matches this query"). The system prompt is the natural home for the former; the per-turn context block is the natural home for the latter.

### Render integration

`renderWorkspace` (`src/core/render.ts`) already includes a `## Recent Journal` section inside the workspace block, fed by whatever entries the caller passes. This design does not change `renderWorkspace`; it only changes the entries fed to it.

The block still appears at the end of `<mykb-workspace>`, after handoff, repos, state line, knowledge areas, links, and artifacts. That ordering is dictated by `renderWorkspace` and matches both the operator-facing `kb work start` output and the LLM-facing system-prompt injection.

### Implementation

A pure-function selector lives at `src/core/journal-window.ts`:

```ts
export function filterRecentJournal(
  entries: JournalEntry[],
  cutoffISO: string,
  maxEntries: number,
): JournalEntry[] {
  const recent = entries.filter((e) => e.date >= cutoffISO);
  return recent.slice(-maxEntries);
}

export function cutoffForDays(days: number, now: Date = new Date()): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}
```

`filterRecentJournal` is a pure function — `cutoffISO` is an input, not computed inside — which makes it trivially testable without fake timers and reusable from any future call site that wants the same window semantics.

The session hook calls:

```ts
const allRecent = wsStorage.readJournal(activeId, JOURNAL_INJECT_MAX_ENTRIES);
const journalEntries = filterRecentJournal(
  allRecent,
  cutoffForDays(JOURNAL_INJECT_DAYS),
  JOURNAL_INJECT_MAX_ENTRIES,
);
```

The two-step pull (read up to M from disk, then filter by date) is cheap on the ordering invariant guaranteed by `appendJournal` — `journal.jsonl` is append-only, so the file's last N entries are always the newest N entries by date.

## Storage

No new storage. Journal already exists on disk.

## Trust and provenance

Journal entries are operator-authored by construction (`kb work journal` is interactive-only; no agent path exists today). They do not need the trust gating from `envelope-v2-DESIGN.md` for this feature to be safe.

If a future change adds agent-authored journal entries (e.g., an autonomous summarizer), this design must revisit: agent-authored journal would need the same trust filtering as Tier-1 entries. The defensive default at that point: agent journal entries are stored but not auto-injected.

## Configuration (deferred)

`N = 2` and `M = 20` are hardcoded constants in this implementation. The design's earlier draft proposed `~/.mykb/config.json` and per-workspace `workspace.json` overrides, plus CLI flags `--journal-days <N>` and `--no-journal` on `kb work start`. None of that is in this implementation; deferred to a follow-up. The hardcoded defaults are correct for the §16 commitment ("default last 2 days").

## Open questions

- **Should `kb work start` and `kb work show` adopt the same window?** Currently they use cap=3 and cap=5 respectively. Operator-facing terminal output may want a different default (e.g., readability over completeness). Defer the unification decision.
- **Time zone for the cutoff.** `cutoffForDays` uses host local time via `Date.now()`. Edge case: a session that starts at 00:30 local with `N=2` effectively gets ~1.5 calendar days. Acceptable; refining to "calendar days minus N" complicates testing for marginal value.
- **Interaction with `kb work checkpoint`.** Checkpoints write multiple journal entries in a batch via `WorkspaceStorage.checkpoint` (`src/core/types.ts:282`). Those entries land in the journal and become eligible for injection on the next session via the same `readJournal` path. No special handling required.
