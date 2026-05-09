# Journal Auto-Injection — Recent Workspace Journal at Session Start

> Status: design — implements §16 commitment 7 from `v2-harness-memory-RESEARCH.md`.
> Companion docs: `workspace-cold-start-ANALYSIS.md`, `workspaces-DESIGN.md`, `checkpoint-feature-DESIGN.md`.

## Problem

The current workspace cold-start surfaces two pieces of session-continuity content when the user runs `kb work start <id>`:

1. The **handoff** — a single-overwrite text describing what's in flight and what's next.
2. The **journal** — append-only milestone log, read on demand via `kb work journal --show N`.

Handoff handles the "where did we leave off" case well. Journal does not auto-load — to see prior milestones the user runs an explicit command. In practice this means the LLM never sees journal content unless the user pastes it in, and the kb's record of *what has been done* over the last few days is invisible to the very session that needs it.

pi-mem (research brief §10) is the worked counter-example: a memory system that does almost nothing right by mykb's standards (no curation, no zones, flat append-only) but injects recent journal content into every session and produces noticeably better continuity than systems with sophisticated curation but no recency injection.

The conclusion in §16 commitment 7: **auto-inject the last N days of journal at session start**. Not on-demand, not via a flag — by default, every session.

## Current state

```ts
// src/core/types.ts:242
export type JournalEntry = {
  date: string;
  text: string;
};
```

Journal entries live in `~/.mykb/workspaces/<id>/journal.jsonl`, appended via `kb work journal "text"`, read on demand via `kb work journal --show N`. The hook at `src/extension/hooks/context.ts` does not currently load journal content.

`kb work start <id>` renders a "Recent Journal" block in its output (visible above as part of the workspace start-up prose), but that prose is only seen by the operator running the command, not by the LLM in subsequent prompts unless the operator copies it forward.

## Proposed design

A small change with disproportionate impact. The hook auto-loads recent journal alongside the handoff and area knowledge it already injects.

### Scope

For the active workspace (resolved via `getActiveWorkspaceId` from `WorkspaceStorage`):

- Read journal entries with `date >= today - N days`.
- Default `N = 2` (i.e. yesterday and today).
- Cap at `M = 20` entries hard ceiling regardless of N (defends against pathological journal-spam workspaces).

Render as:

```markdown
## Recent journal (workspace <id>, last N days)

- 2026-05-08: <text>
- 2026-05-07: <text>
- 2026-05-07: <text>
```

This block is injected into the same context bundle as the handoff and area knowledge. Order in the bundle (top-to-bottom):

1. Handoff (single most recent, if present).
2. Recent journal (this section).
3. Area knowledge (existing area-rendering output).

Rationale for the ordering: handoff is the highest-precision continuity signal (operator-written, scoped to "right now"); journal is recent context; area knowledge is general reference. The LLM should see them in that order of specificity.

### N and M as configuration

`~/.mykb/config.json`:

```json
{
  "workspace": {
    "journal_inject_days": 2,
    "journal_inject_max_entries": 20
  }
}
```

Per-workspace override in `~/.mykb/workspaces/<id>/workspace.json`:

```json
{
  "config": {
    "journal_inject_days": 7
  }
}
```

The per-workspace override is useful for slow-cadence workspaces (research projects with weekly journals, where 2 days is empty). Defaults stay at `N=2`.

### CLI override

```
kb work start <id> --journal-days <N>     # one-off override
kb work start <id> --no-journal           # disable for this session
```

Hook respects the per-session override via an env var `MYKB_JOURNAL_DAYS` written by `kb work start` into the active-workspace state file. Cleared by `kb work stop`.

## Hook integration

The hook in `src/extension/hooks/context.ts` learns to:

1. Resolve active workspace (already does this for area boosting in `scoreAreas` via `boostedAreas`).
2. Load recent journal via `WorkspaceStorage.readJournal(id, M)`, then filter by date >= today - N.
3. Render the journal block before area-rendered output.

`readJournal(id, limit)` already exists (`src/core/types.ts:308`) — it reads the last N entries. The date filter is applied after the read; for journals up to a few hundred entries this is fine.

The token cost is small: 2 days of journal in an active workspace is ~5–10 entries, ~500 tokens. The hook's existing token budget (governed by `selectEntriesForInjection`) gets the journal block subtracted from it before area entries are pulled.

If the journal block alone exceeds 25% of the token budget, the hook truncates from the oldest end (keeps the most recent entries) and notes the truncation in the rendered output:

```markdown
## Recent journal (workspace <id>, last N days, truncated to fit budget)

- ... 12 older entries omitted ...
- 2026-05-08: <text>
- 2026-05-09: <text>
```

## Storage

No new storage. Journal already exists on disk.

## Migration

1. **Hook learns to load journal.** Defaults to N=2, M=20. No config required.
2. **Per-workspace overrides land.** Optional config schema added.
3. **CLI flags added** (`--journal-days`, `--no-journal`).

Each phase is independently shippable. Phase 1 alone delivers the §16 commitment.

## Backwards compatibility

- Workspaces without journal entries inject nothing — the block is omitted, not rendered empty.
- Sessions outside an active workspace inject nothing — same as today.
- Users who dislike the auto-inject can set `journal_inject_days: 0` globally or `--no-journal` per session.

## Trust and provenance

Journal entries are operator-authored by construction (`kb work journal` is interactive-only, no agent path exists today). They do not need the trust gating from `envelope-v2-DESIGN.md` for this feature to be safe.

If a future change adds agent-authored journal entries (e.g. an autonomous summarizer), this design must revisit: agent-authored journal would need the same trust filtering as Tier-1 entries. The defensive default at that point: agent journal entries are stored but not auto-injected.

## Open questions

- **Should recent handoffs from other workspaces also inject?** No, by design — the user has chosen one active workspace. Cross-workspace injection is the cross-area-curation problem in disguise (see `docs/cross-area-curation-ANALYSIS.md`). Defer.
- **Time zone for the "last N days" cutoff.** Recommend the host's local time. Edge case: a session starts at 00:30 local and N=2 effectively gives 1.5 days. Acceptable; refining to "calendar days minus N" complicates testing for marginal value.
- **Journal entries authored during the current session.** A long session can append new journal entries; subsequent prompts in the same session re-run the hook and would see them. This is the desired behavior — the journal is the running log. Idempotency of injection is guaranteed because the journal text doesn't change once written.
- **Interaction with `kb work checkpoint`.** Checkpoints write multiple journal entries in a batch via `WorkspaceStorage.checkpoint` (`src/core/types.ts:282`). Those entries land in the journal and become eligible for injection on the next session. No special handling required; checkpoint is just another journal writer.
