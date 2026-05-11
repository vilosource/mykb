# Experiment: kb-work-tools

**Source spec:** `src/tools/kb-work-journal.ts`, `src/tools/kb-work-state.ts`, `src/tools/kb-work-note.ts` — three LLM-callable tools registered by `registerTools()` for mid-session workspace mutation.
**Implementation under test:** the LLM-as-mutator path for the active workspace. Where `kb work checkpoint` is the **batch** path (one-shot JSON), these tools are the **streaming** path (each tool call mutates one field).

## Status

✅ **Implemented.** All four scenarios GREEN against a real Pi runtime, each RED-proven:

| Scenario | GREEN | RED-proof (mutated build) |
|----------|-------|---------------------------|
| `journal-tool` | 11/11 | `wsStorage.appendJournal` no-op → `journal.jsonl` never written (4 assertions flip) |
| `state-tool` | 12/12 | `wsStorage.updateWorkspaceState` no-op → phase never persists; step-2 LLM can't quote the marker from `<mykb-workspace>` (2 assertions flip) |
| `note-tool` | 12/12 | `wsStorage.appendNote` no-op → `notes.jsonl` never written (4 assertions flip) |
| `no-active-workspace` | 11/11 | drop the `if (!activeId)` guard in `executeKbWorkJournal` → the tool throws `Workspace not found: undefined` instead of the graceful message, so `assert_llm_contains_any` no longer sees a "no active workspace" string (1 assertion flips) |

Tracked in [`docs/experiment-coverage.md`](../../docs/experiment-coverage.md).

## Intent

A long Claude Code session has two patterns for capturing itself into the brain:

1. **Batch:** `/kb work checkpoint` once at session end. Single LLM extraction → single mutation. Tested by [`work-checkpoint`](../work-checkpoint/).
2. **Streaming:** the LLM calls `kb_work_journal` / `kb_work_state` / `kb_work_note` whenever a milestone happens. Each tool call mutates a separate workspace field; the brain's view of "what's happening now" stays current without an end-of-session checkpoint.

Pattern (2) is the load-bearing one for sessions that crash before checkpoint: the journal/state are accurate at the time of the crash, and the next session can resume cleanly.

This matrix proves the LLM **can actually use** these tools end-to-end:

- Tool registered → LLM sees it in available-tools list.
- LLM constructs a valid call → store mutation succeeds → JSONL gains entry / `state.json` updates.
- A second LLM call sees the mutation in its context (via `<mykb-workspace>`).

## Behavior matrix

| Stimulus | Expected behavior | Scenario |
|----------|-------------------|----------|
| LLM is told to record a milestone via `kb_work_journal` | Tool fires; workspace's `journal.jsonl` gains the marker | `journal-tool` |
| LLM is told to update workspace state (phase or active) via `kb_work_state` | Tool fires; `state.json` reflects the update; LLM in a *follow-up* step sees the new state in `<mykb-workspace>` | `state-tool` |
| LLM is told to add a tagged note via `kb_work_note` | Tool fires; `notes.jsonl` gains the entry with the tag | `note-tool` |
| All three tools available; LLM has no active workspace | Calls error gracefully; no partial mutations | `no-active-workspace` |

The pair pattern repeats: positive scenarios for each tool + a shared negative (no-active-workspace) bounds the contract from both sides. The "follow-up step sees the change" assertion in `state-tool` is the integration anchor — proves persistence works across the file-backed `SessionState` boundary.

## Notes

- **Synthetic workspace per run.** Each scenario creates an `e2e-${tool}-${E2E_RUN_UUID:0:8}` workspace in `prepare()` and `kb work start`s it. `scenario.sh` clears any inherited `workspaces/.active` first; the Pi container has `KB_SESSION_ID` set but no session file, so `getActiveWorkspaceId()` falls back to `.active` (GH issue #5). `no-active-workspace` deliberately creates nothing.
- **Marker discipline.** The marker is in the prompt (the milestone text / phase / note text the LLM should record); assert it lands in the resulting JSONL / `workspace.json` on disk.
- **No fallback tools.** Forbid `kb_search`/`kb_load`/`kb_list`/`bash` plus the *other* `kb_work_*` tools in the prompt + `assert_no_tool_calls` for each. Do **not** set `SPIKE_DISABLE_TOOLS` — `MYKB_DISABLE_TOOLS=1` skips `registerTools()` entirely, which would un-register the tool under test.
- **Multi-step for `state-tool`, and the step-1 assertions.** Step 1 has the LLM call `kb_work_state`; step 2 (same `KB_SESSION_ID`) asks "what's the current phase?" — answered from the `<mykb-workspace>` block `before_agent_start` re-renders from disk each turn. `SPIKE_LAST_STEP_FILE` points at step 2 during `observe()`, so the "tool was called in step 1" assertions temporarily repoint it at `.e2e-steps/state-tool/001-set-phase.json`. The known starting phase (`scaffolding`, distinct from the marker) is what makes the RED-proof bite.
- **`no-active-workspace`'s "no mutation" check.** Uses `assert_no_branch_diff_match` for `workspaces/.+/(journal|notes)\.jsonl$` and `workspaces/.+/workspace\.json$`. `assert_branch_diff_empty` is unusable — the harness commits its own `.e2e-steps/` files and the cleared `workspaces/.active` onto every scenario branch. (The negative companion's RED-proof only flips one assertion, the graceful-message one; the "no mutation" assertions are unit-tested in `tests/spike/assert.bats`.)
- **Integration with file-backed SessionState (cycle 8).** All scenarios set `SPIKE_SCENARIO_SESSION_ID` (automatic in `scenario.sh`) so multi-step tests rely on persistence.

## Out of scope

- The `kb work` CLI surface — covered by L1 / CLI tests.
- Cross-tool atomicity (e.g., journal + state in one logical operation) — that's `kb work checkpoint`'s job; this matrix is per-tool.
- Tag validation for `kb_work_note` — the schema check is L1.
