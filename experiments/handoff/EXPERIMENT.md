# Experiment: handoff

**Source spec:** `docs/handoff-feature-DESIGN.md` (workspace handoff feature, also referenced from the manifesto's Workspace section).
**Implementation:** `src/extension/hooks/session.ts` (handoff injection at `before_agent_start`), `src/cli/work.ts` (CLI surface).

## Intent

Workspace handoffs are a session-continuity feature: text the operator captures with `kb work handoff "..."` should be visible to the LLM at the start of the next session, so the next session can resume without ramp-up.

The behavior emerges only when Pi runs against a real brain — unit tests prove "the function reads handoff.json", but the user-visible question is "does the LLM actually use the handoff text when answering questions about resuming work?" That's what this experiment validates.

## Behavior matrix

| Stimulus | Expected behavior | Scenario |
|----------|-------------------|----------|
| Workspace has prior handoff text | LLM cites the handoff content when asked about resuming | `continuity` |
| Two handoffs written in sequence | Second overwrites first; LLM sees only the second | `overwrite` |
| `kb work handoff --clear` | LLM no longer sees the old handoff content | `clear` |
| No active workspace | No handoff block leaks into the system context | `no-active-workspace` |

## Notes

- Handoffs are workspace-scoped; the experiment must `kb work create` and `kb work start` before writing the handoff so the harness mirrors a plausible workflow.
- Setup must reproduce the lineage: workspace → state → some journal entries → then the handoff that summarizes where things stand. A handoff written into a vacuum is not a realistic test of the feature.
- The methodology rule "marker must be unique per scenario per run" applies: scenarios use `$E2E_RUN_UUID` (auto-set by the harness) embedded in the handoff text so a stale fixture from a previous run can't accidentally satisfy this run's assertion.
- `overwrite` and `clear` and `no-active-workspace` are stubs (next-up); only `continuity` is implemented in this commit. They follow the same shape and should be added when actively iterating on handoff behavior.
