# Experiment: journal-auto-inject

**Source spec:** `docs/journal-auto-inject-DESIGN.md`
**Implementation:** `src/extension/hooks/session.ts` (before_agent_start) + `src/core/journal-window.ts` (filterRecentJournal helper)

## Intent

The `before_agent_start` hook injects up to the last 20 journal entries from the active workspace, filtered to entries dated within the last 2 days. The aim: when a session resumes, the LLM has yesterday's milestones in its system prompt automatically — without the operator having to ask for them or set up tooling.

This is the feature that motivated the experimentation methodology. The behavior emerges only when Pi runs against a real brain: unit tests prove `filterRecentJournal` returns the right list given inputs; this experiment proves the rendered system prompt actually steers the LLM toward the recent work and away from the stale work.

The spec references `docs/journal-auto-inject-DESIGN.md` for the rationale on `before_agent_start` placement (cache-friendly per-turn injection vs. the per-turn context hook which thrashes the cache) — important when reading the matrix below, since "cache-friendly" means the same injection bytes survive multiple turns and the mid-session-append case has to re-fire the hook.

## Behavior matrix

| Stimulus | Expected behavior | Scenario |
|----------|-------------------|----------|
| Workspace has a journal entry from today (within the 2-day window) | LLM cites the entry's content when asked about recent work | `resume-continuity` |
| Workspace has only journal entries from > 2 days ago (outside the window) | LLM does NOT cite the stale entries | `stale-filter` |
| Operator/agent writes a new journal entry between turn 1 and turn 2 | Turn 2's LLM sees the new entry (per-turn re-injection) | `mid-session-append` |
| No active workspace at the time of the prompt | No journal block leaks into the system prompt; LLM cannot cite any journal | `no-active-workspace` |

## Notes

- **Stale-filter setup uses direct journal.jsonl mutation.** `kb work journal` always writes today's date — there's no flag for "write with date X." To stage entries that are >2 days old without inventing a feature solely for tests, we write to `journal.jsonl` directly with a backdated `date` field. The methodology's "plausible workflow lineage" rule still applies: the file shape, fields, and ordering must match what `appendJournal` would produce. We do this once in `prepare()` and the rest of the scenario uses the normal `kb` surface.
- **The marker discipline** is the same as the handoff matrix: `E2E_RUN_UUID` per run, embedded in journal text, asserted via `assert_llm_contains` (positive) or `assert_llm_not_contains` (negative).
- **`assert_step_status_is "completed"`** is mandatory in every scenario — without it, a vfa timeout / runaway-streaming failure would falsely satisfy the negative assertions (LLM never reached the leak point).
- The methodology calls out that the cap-saturation case (>20 entries) is covered by the unit test for the helper (`tests/core/journal-window.test.ts`); no Layer-4 scenario for it.
- `cutoffForDays(2)` includes today and yesterday. Today's entry is recent. An entry dated 3 days ago is stale. An entry dated 2 days ago today is on the boundary — we don't probe boundary behavior here because the host-time-zone interaction (see DESIGN doc §"Open questions") makes it brittle as a regression assertion.
