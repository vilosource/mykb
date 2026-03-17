# Journal-Knowledge Gap: OSB Finding

## Problem

During mykb development on OSB, all journal entries were written diligently after every milestone — but zero structured knowledge (facts, decisions, patterns, gotchas) was extracted. After ~24 hours of intensive work producing 299 tests, 17 areas, workspaces, acceptance tests, and a knowledge harness design, the OSB workspace had a complete narrative record but stale structured knowledge.

The workspace *looked* complete because the journal was thorough. The gap was only discovered when loading the workspace in a new session and noticing the knowledge section hadn't changed since initial design.

## Root Cause

Journaling and knowledge capture feel similar enough that writing a journal entry gives the cognitive satisfaction of "I recorded that" — but they serve different purposes:

| Aspect | Journal | Structured Knowledge |
|--------|---------|---------------------|
| Purpose | Narrative record of what happened | Indexed, queryable facts for future context |
| Format | Free text, chronological | Typed entries (fact, decision, pattern, gotcha) with provenance |
| Consumption | Read sequentially by humans | Loaded into LLM context, matched by scorers, boosted by workspaces |
| Decay | Stays relevant as history | Must be kept current to be useful |

The journal captures **what happened**. Structured knowledge captures **what we learned**. OSB provides no mechanism to bridge the two — they are completely independent write paths with no cross-referencing, validation, or extraction workflow.

## Impact

- New sessions load stale facts/decisions/patterns that don't reflect actual project state
- Knowledge areas miss important gotchas discovered during implementation
- Decisions made during development aren't recorded, so rationale is lost
- Patterns proven in practice never get formalized for reuse
- The journal contains all the information but it's locked in narrative form — not queryable, not scorable, not injectable

## How mykb Must Fix This

### 1. Post-Journal Knowledge Extraction Prompt

When a journal entry is written via `kb work journal`, the system should prompt (or auto-suggest) structured knowledge extraction. The journal text itself contains the raw material — facts, decisions, patterns, and gotchas are embedded in the narrative.

**Minimum viable approach:** After writing a journal entry, emit a suggestion:
```
Journal saved. Consider extracting:
  kb add --area <linked-area> "fact derived from journal"
  kb add --type decision "decision made during this work"
```

**Better approach:** LLM-assisted extraction. Feed the journal entry to the knowledge harness and let it suggest candidate facts/decisions/patterns/gotchas with `--type` and `--area` pre-filled.

### 2. Knowledge Freshness Indicator

Track when structured knowledge was last updated relative to journal activity. If the journal has 5+ entries since the last `kb add`, surface a warning:

```
⚠ Workspace "mykb" has 8 journal entries since last knowledge update.
  Run `kb extract` to review and extract structured knowledge.
```

This could be checked on `kb work show` or on session start context injection.

### 3. `kb extract` Command

A dedicated command that:
1. Reads recent journal entries (since last extraction, or last N entries)
2. Identifies candidate facts, decisions, patterns, and gotchas
3. Presents them for confirmation/editing
4. Writes confirmed entries via the standard `kb add` path

This is the automation of the manual process that was done to fix the OSB gap.

### 4. Session Lifecycle Integration

The knowledge harness design (docs/knowledge-harness-DESIGN.md) defines a `session_shutdown` phase. This is the natural checkpoint to:
- Compare journal entry count vs knowledge entry count since last session
- Prompt for extraction if the ratio is skewed
- Auto-save workspace state (already planned)

This maps to the harness hook: `on_session_end` → check freshness → prompt extraction.

## Design Guardrails

- Extraction should be **prompted, not forced** — not every journal entry produces structured knowledge
- The extraction flow must work in **all three runtimes** (Pi, Claude Code, Gemini CLI) via the kb-hook interface
- Extracted knowledge must follow the same provenance model (source = journal entry ID or date)
- The freshness check should be lightweight — count comparison, not content analysis
- `kb extract` should be usable standalone (CLI) and as part of session lifecycle (hook)

## Priority

This should be addressed in the knowledge harness implementation (Phase 1+). The `kb extract` command and freshness indicator are natural extensions of the hook system already designed. The journal-to-knowledge bridge is a core differentiator over OSB's disconnected model.

## References

- OSB workspace that exhibited this gap: `mykb` workspace in `~/.osb/main/brain/`
- Knowledge harness design: `docs/knowledge-harness-DESIGN.md` (session lifecycle hooks)
- Workspaces design: `docs/workspaces-DESIGN.md` (journal and knowledge integration)
