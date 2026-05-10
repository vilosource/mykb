# Experiment: kb-work-tools

**Source spec:** `src/tools/kb-work-journal.ts`, `src/tools/kb-work-state.ts`, `src/tools/kb-work-note.ts` — three LLM-callable tools registered by `registerTools()` for mid-session workspace mutation.
**Implementation under test:** the LLM-as-mutator path for the active workspace. Where `kb work checkpoint` is the **batch** path (one-shot JSON), these tools are the **streaming** path (each tool call mutates one field).

## Status

🚧 **Scaffolded — scenarios not yet implemented.** Tracked in [`docs/experiment-coverage.md`](../../docs/experiment-coverage.md).

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

## Notes (when implementing)

- **Synthetic workspace per run.** Each scenario creates `e2e-${tool}-${E2E_RUN_UUID:0:8}` workspaces.
- **Marker discipline.** The marker is in the prompt (the milestone text the LLM should record); assert it lands in the resulting JSONL/state file.
- **No fallback tools.** Forbid `kb_search`/`kb_load`/`kb_list`/bash in the prompt + `assert_no_tool_calls` for the prefixes that aren't the tool under test. Prevents the LLM from "answering" via a different path.
- **Multi-step for `state-tool`.** Step 1 has the LLM call `kb_work_state`. Step 2 (same KB_SESSION_ID) asks "what's the current phase?" — should answer from `<mykb-workspace>` containing the new state. Tests the cross-step persistence wired up in cycle 8.
- **Integration with file-backed SessionState (cycle 8).** All these scenarios should set `SPIKE_SCENARIO_SESSION_ID` (already automatic in scenario.sh) so multi-step tests can rely on persistence.

## Out of scope

- The `kb work` CLI surface — covered by L1 / CLI tests.
- Cross-tool atomicity (e.g., journal + state in one logical operation) — that's `kb work checkpoint`'s job; this matrix is per-tool.
- Tag validation for `kb_work_note` — the schema check is L1.
