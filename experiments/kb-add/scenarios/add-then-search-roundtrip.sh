# experiments/kb-add/scenarios/add-then-search-roundtrip.sh
#
# The load-bearing scenario of the kb-add matrix: the full closed loop
# write → index → retrieve, end to end, across two separate Pi
# containers sharing one KB_SESSION_ID.
#
#   step 1  the LLM calls kb_add to record a fact carrying the marker.
#           This appends to areas/<id>/facts.jsonl AND dbUpsert()s the
#           entry into the FTS5 index (knowledge-store.ts persistEntry).
#   step 2  a fresh Pi container (same scenario, new conversation) is
#           asked to find the marker via kb_search. The only way it can
#           surface the marker text is if the FTS index picked up step
#           1's write. There is no conversation carry-over between the
#           two steps — step 2's LLM never saw step 1's tool result — so
#           a hit proves the index, not the chat history.
#
# A regression at any link breaks this: kb_add not writing JSONL, not
# updating SQLite, the cross-container db rebuild not happening, or
# kb_search's FTS query not matching. add-fact isolates link 1; this
# scenario is the integration anchor for the rest.
#
# RED-proof (cheapest): in src/tools/kb-search.ts, make the tool's
# execute return `{ content: [{ type: 'text', text: 'No matches.' }],
# details: {} }` unconditionally — step 2's LLM gets nothing back, so
# assert_llm_contains for the marker flips while step 1's file-state
# assertions still pass (proving the failure is in retrieval, not write).
# Alternatively mutate persistEntry to skip dbUpsert — then step 1
# writes JSONL but the index never updates and the *post-run* db rebuild
# in scenario.sh would re-index it... so prefer the kb-search mutation,
# which is unambiguous. (`npm run bundle:all`, kb-spike new, run; then
# `git checkout -- src/` + rebuild.)
#
# Note: we do NOT set SPIKE_DISABLE_TOOLS — MYKB_DISABLE_TOOLS=1 skips
# registerTools(), un-registering both kb_add and kb_search.

intent "The LLM adds a fact via kb_add in step 1, then finds it via kb_search in step 2 — proving write → FTS index → retrieve works"

E2E_RUN_UUID="${E2E_RUN_UUID:-$(date -u +%s%N)}"
ROUNDTRIP_MARKER="ROUNDTRIP_MARKER_${E2E_RUN_UUID}"
AREA_ID="e2e-widgets-${E2E_RUN_UUID:0:8}"
WS_ID="e2e-rt-${E2E_RUN_UUID:0:8}"

prepare() {
  # Plausible lineage: a workspace whose linked area the operator is
  # building out this session, then immediately queries.
  kb init area "$AREA_ID" "Widget tolerances" \
    "Mechanical tolerances and torque specs for the widget assembly line"
  kb work create "$WS_ID" "Add-then-search demo" --areas "$AREA_ID"
  kb work start "$WS_ID"
  kb work state --phase "implementation" --active "recording widget torque specs"
  kb save
}

stimulate() {
  step "add-fact" --prompt "Record a durable fact in the knowledge base by calling the kb_add tool (a registered tool, not a shell command): area set to exactly '${AREA_ID}', type set to exactly 'fact', and text set to exactly '${ROUNDTRIP_MARKER}: the M6 widget bolts torque to 9.5 newton-metres on the assembly line'. Use ONLY the kb_add tool — do not use bash, read, write, edit, or any other kb_* tool. After the tool returns, just say 'done'."

  step "search-fact" --prompt "Use ONLY the kb_search tool (a registered tool, not a shell command) to look up '${ROUNDTRIP_MARKER}' in the knowledge base. Do not use kb_load, kb_list, bash, or any other tool. Quote the entire matching entry verbatim in one line, including the marker."
}

observe() {
  # ── Step 1: the add landed via the tool path. SPIKE_LAST_STEP_FILE
  #    points at step 2 in observe(), so repoint it at step 1's file for
  #    these checks, then restore.
  local _last="$SPIKE_LAST_STEP_FILE"
  SPIKE_LAST_STEP_FILE="$SPIKE_INSTANCE/.e2e-steps/${SPIKE_SCENARIO}/001-add-fact.json"
  assert_tool_called   "kb_add"
  assert_no_tool_calls "kb_search"
  assert_no_tool_calls "kb_load"
  assert_no_tool_calls "kb_list"
  assert_no_tool_calls "bash"
  SPIKE_LAST_STEP_FILE="$_last"

  # Step 1's write landed on disk (write link of the loop).
  assert_branch_diff_contains "areas/${AREA_ID}/facts.jsonl"
  assert_jsonl_count    "areas/${AREA_ID}/facts.jsonl" 1
  assert_jsonl_contains "areas/${AREA_ID}/facts.jsonl" "$ROUNDTRIP_MARKER"

  # ── Step 2 (current SPIKE_LAST_STEP_FILE): the retrieve link. The
  #    marker came back through kb_search's FTS result — proving the
  #    index picked up step 1's write across the container boundary.
  assert_tool_called   "kb_search"
  assert_no_tool_calls "kb_load"
  assert_no_tool_calls "kb_list"
  assert_no_tool_calls "kb_add"
  assert_no_tool_calls "bash"
  assert_llm_contains  "$ROUNDTRIP_MARKER"
  assert_llm_contains_any "9.5" "newton" "torque"
  assert_step_status_is "completed"
}
