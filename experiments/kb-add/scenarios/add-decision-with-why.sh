# experiments/kb-add/scenarios/add-decision-with-why.sh
#
# Covers the `add-decision-with-why` row of the kb-add matrix: when the
# session records a *decision*, the LLM must call kb_add with
# `type: 'decision'` AND populate the `why` rationale field — and that
# rationale must persist on the entry, not get dropped.
#
# This is the discriminator scenario for the kb_add schema: `why` is a
# decision-only field. `executeKbAdd` routes 'decision' through
# `store.addDecision(area, text, { ...baseOptions, why, rejected })`,
# which writes `why` onto the entry (knowledge-store.ts addDecision).
# add-fact proves the basic write; this proves the per-type field
# threading the LLM has to get right from a natural-language prompt.
#
# Marker discipline: the marker is in the decision *text*; the rationale
# carries a second distinguishing string (RATIONALE_…). We assert both
# land on the same JSONL line so a regression that writes the decision
# but drops `why` is caught.
#
# RED-proof: in src/core/knowledge-store.ts addDecision, delete the
# `if (options?.why) (entry as Record<string, unknown>).why = options.why;`
# line — the decision still lands but without `why`, so the
# assert_jsonl_contains for the rationale string flips. (`npm run
# bundle:all`, kb-spike new, run; then `git checkout -- src/` + rebuild.)
#
# Note: we do NOT set SPIKE_DISABLE_TOOLS — MYKB_DISABLE_TOOLS=1 skips
# registerTools() entirely, which would un-register kb_add too.

intent "The LLM records a decision with a why-rationale via kb_add; decisions.jsonl gains the entry preserving the rationale"

E2E_RUN_UUID="${E2E_RUN_UUID:-$(date -u +%s%N)}"
DECISION_MARKER="DECISION_MARKER_${E2E_RUN_UUID}"
RATIONALE_MARKER="RATIONALE_MARKER_${E2E_RUN_UUID}"
AREA_ID="e2e-arch-${E2E_RUN_UUID:0:8}"
WS_ID="e2e-adddec-${E2E_RUN_UUID:0:8}"

prepare() {
  # Plausible lineage: an architecture workspace whose linked area
  # records the decisions made along the way.
  kb init area "$AREA_ID" "Service architecture" \
    "Topology, transport, and consistency decisions for the ingest service"
  kb work create "$WS_ID" "Add-decision demo" --areas "$AREA_ID"
  kb work start "$WS_ID"
  kb work state --phase "design" --active "settling the ingest transport"
  kb save
}

stimulate() {
  step "record-decision" --prompt "Record an architecture decision in the knowledge base by calling the kb_add tool (a registered tool, not a shell command): area set to exactly '${AREA_ID}', type set to exactly 'decision', text set to exactly '${DECISION_MARKER}: the ingest service will use NATS JetStream for the event transport', and the why field set to exactly '${RATIONALE_MARKER}: JetStream gives at-least-once delivery plus replay without a separate broker'. Use ONLY the kb_add tool — do not use bash, read, write, edit, kb_work_journal, kb_work_state, kb_work_note, kb_verify, or any kb_search/kb_load/kb_list tool. After the tool returns, just say 'done'."
}

observe() {
  assert_tool_called "kb_add"
  assert_no_tool_calls "kb_search"
  assert_no_tool_calls "kb_load"
  assert_no_tool_calls "kb_list"
  assert_no_tool_calls "kb_verify"
  assert_no_tool_calls "kb_work_journal"
  assert_no_tool_calls "kb_work_state"
  assert_no_tool_calls "kb_work_note"
  assert_no_tool_calls "bash"

  # The decision landed in decisions.jsonl (NOT facts.jsonl) with both
  # the decision-text marker and the rationale marker on the same line.
  assert_branch_diff_contains "areas/${AREA_ID}/decisions.jsonl"
  assert_jsonl_count    "areas/${AREA_ID}/decisions.jsonl" 1
  assert_jsonl_contains "areas/${AREA_ID}/decisions.jsonl" "$DECISION_MARKER"
  assert_jsonl_contains "areas/${AREA_ID}/decisions.jsonl" "$RATIONALE_MARKER"
  # A regression that misroutes the decision into facts.jsonl would be
  # caught here too.
  assert_branch_diff_not_contains "areas/${AREA_ID}/facts.jsonl"

  assert_step_status_is "completed"
}
