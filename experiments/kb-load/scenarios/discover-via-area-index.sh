# experiments/kb-load/scenarios/discover-via-area-index.sh
#
# Integration regression guard — the load-bearing scenario for this
# experiment. The prompt names only the topic (not the area-id);
# the LLM must discover the area-id from <mykb-areas> in its system
# prompt, then call kb_load with that id.
#
# This protects the chain: area-index injection → LLM reads index →
# LLM picks the right area-id → kb_load returns entries → LLM cites
# marker. Cycle 5 (kb_search) implicitly depended on this chain
# working when its scenarios verified the no-fabrication property
# during RED-proof. If <mykb-areas>'s shape regresses (heading levels,
# id format, summary truncation), this scenario goes RED.
#
# Discipline applied:
#   - Prompt forbids kb_search and kb_list so the marker can only
#     reach the LLM via kb_load.
#   - observe() asserts kb_load fired AND no fallbacks fired.
#   - Marker is unique per run so prior fixtures can't satisfy.

intent "LLM discovers area-id from <mykb-areas> and uses kb_load to surface the marker"

E2E_RUN_UUID="${E2E_RUN_UUID:-$(date -u +%s%N)}"
FROB_MARKER="FROB_MARKER_${E2E_RUN_UUID}"
AREA_ID="e2e-frobnicators-${E2E_RUN_UUID:0:8}"

prepare() {
  # Area with a distinctive summary keyword. The LLM will see this
  # in <mykb-areas> and (we expect) match it against the prompt's
  # topic word ('frobnicator') to pick the right area-id.
  #
  # Critical: this scenario must NOT create or link a workspace.
  # The <mykb-workspace> block — when an active workspace exists —
  # also lists linked area-ids, which would give the LLM a second
  # discovery path. This scenario isolates the area-index path by
  # ensuring <mykb-areas> is the ONLY place the area-id appears in
  # system context. Plausible lineage: a fresh session before the
  # operator has started a workspace.
  kb init area "$AREA_ID" "Frobnicators" \
    "Frobnicator calibration tolerances, drift coefficients, and field-replaceable assemblies" \
    --tags frobnicator,calibration

  kb add fact "$AREA_ID" "${FROB_MARKER}: blue units are rated for 12.7 hertz with a 3% tolerance band." \
    --tags spec,hertz

  kb save
}

stimulate() {
  # Topic-only prompt. The LLM has to infer that 'frobnicator' maps
  # to AREA_ID by reading <mykb-areas> in its system prompt. Then
  # call kb_load with that id. This is the area-index → kb_load
  # chain under test.
  step "discover-and-load" --prompt "There is an area in the knowledge base about frobnicator calibration. Look at the <mykb-areas> section of your system context to find its area-id, then use ONLY the kb_load tool to load it. Do not use kb_search or kb_list. Quote the entire matching fact verbatim in one line, including any text starting with 'FROB_MARKER'. Do not paraphrase."
}

observe() {
  # The chain worked: LLM picked an area-id and called kb_load.
  assert_tool_called    "kb_load"
  assert_no_tool_calls  "kb_search"
  assert_no_tool_calls  "kb_list"
  # The marker arrived via the loaded area's entries.
  assert_llm_contains   "$FROB_MARKER"
  assert_llm_contains_any "12.7" "hertz"
  assert_step_status_is "completed"
}
