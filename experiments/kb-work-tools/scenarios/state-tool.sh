# experiments/kb-work-tools/scenarios/state-tool.sh
#
# Covers the `state-tool` row of the kb-work-tools matrix — and the
# matrix's integration anchor. Two steps, same KB_SESSION_ID:
#
#   step 1  the LLM calls kb_work_state to set the workspace phase to a
#           unique marker; the mutation lands in workspaces/<id>/workspace.json
#   step 2  asked "what is the current phase?", the LLM answers from the
#           <mykb-workspace> block in its system prompt — which the
#           before_agent_start hook re-renders from disk each turn, so it
#           carries the phase step 1 just wrote. There is no read-side
#           workspace tool, so the only way the LLM can know the new
#           phase is the re-injected context.
#
# The active workspace is created+started in prepare() (scenario.sh
# clears any inherited workspaces/.active first; the Pi container has
# KB_SESSION_ID set but no session file, so getActiveWorkspaceId() falls
# back to .active — see GH issue #5). prepare() also sets a *known*
# starting phase ("scaffolding"), distinct from the marker, so the
# file-state assertion fails (phase stays "scaffolding") if the tool
# no-ops.
#
# RED-proof: make wsStorage.updateWorkspaceState a no-op — workspace.json
# keeps phase "scaffolding", so assert_state_file_field fails and the
# step-2 LLM quotes "scaffolding" instead of the marker.
#
# Note: we do NOT set SPIKE_DISABLE_TOOLS — MYKB_DISABLE_TOOLS=1 skips
# registerTools() entirely, which would un-register kb_work_state too.
# Fallback prevention is by the prompt + assert_no_tool_calls, the same
# way journal-tool / kb-load/basic-load handle it.

intent "The LLM updates workspace phase via kb_work_state; a follow-up step sees the new phase in <mykb-workspace>"

E2E_RUN_UUID="${E2E_RUN_UUID:-$(date -u +%s%N)}"
PHASE_MARKER="phase-marker-${E2E_RUN_UUID}"
WS_ID="e2e-st-${E2E_RUN_UUID:0:8}"

prepare() {
  # Plausible workflow lineage: an active workspace mid-task with a
  # known phase. The LLM is about to advance the phase via kb_work_state.
  kb work create "$WS_ID" "State-tool demo"
  kb work start "$WS_ID"
  kb work state --phase "scaffolding" --active "wiring the rate-limiter"
  kb save
}

stimulate() {
  step "set-phase" --prompt "Update the workspace state by calling the kb_work_state tool (a registered tool, not a shell command) with phase set to exactly: ${PHASE_MARKER}. Use ONLY the kb_work_state tool — do not use bash, read, write, edit, kb_work_journal, kb_work_note, or any kb_search/kb_load/kb_list tool. After the tool returns, just say 'done'."
  step "ask-phase" --prompt "What is the current phase of my active workspace? Reply with ONLY the phase value, copied exactly, and nothing else. Do not use any tools — answer from the workspace context already provided to you in this prompt."
}

observe() {
  # Step 1: the kb_work_state tool path was actually used, and nothing
  # else. assert_*_tool_calls read SPIKE_LAST_STEP_FILE (now step 2), so
  # point them at step 1's file for these checks, then restore.
  local _last="$SPIKE_LAST_STEP_FILE"
  SPIKE_LAST_STEP_FILE="$SPIKE_INSTANCE/.e2e-steps/${SPIKE_SCENARIO}/001-set-phase.json"
  assert_tool_called   "kb_work_state"
  assert_no_tool_calls "kb_search"
  assert_no_tool_calls "kb_load"
  assert_no_tool_calls "kb_list"
  assert_no_tool_calls "kb_work_journal"
  assert_no_tool_calls "kb_work_note"
  assert_no_tool_calls "bash"
  SPIKE_LAST_STEP_FILE="$_last"

  # Step 1's mutation landed on disk (RED-proof anchor: no-op
  # updateWorkspaceState leaves this at "scaffolding").
  assert_state_file_field "workspaces/${WS_ID}/workspace.json" ".state.phase" "$PHASE_MARKER"
  assert_branch_diff_contains "workspaces/${WS_ID}/workspace.json"

  # Step 2 (the current SPIKE_LAST_STEP_FILE): no tools at all — the new
  # phase came back through the re-injected <mykb-workspace> block, not a
  # fresh lookup. This is the cross-step persistence anchor.
  assert_no_tool_calls   ""
  assert_llm_contains    "$PHASE_MARKER"
  assert_step_status_is  "completed"
}
