# experiments/kb-load/scenarios/basic-load.sh
#
# Positive control. The prompt names the area-id directly and tells
# the LLM to use kb_load. Proves the basic plumbing: tool registered,
# captured CLI fires, store.loadArea returns entries, renderMarkdown
# produces text the LLM can read, LLM extracts the marker.
#
# Pair this with unknown-area-no-fabrication (the negative): together
# they bound kb_load's contract from both sides.

intent "kb_load returns area entries; LLM cites the marker fact"

E2E_RUN_UUID="${E2E_RUN_UUID:-$(date -u +%s%N)}"
FROB_MARKER="FROB_MARKER_${E2E_RUN_UUID}"
AREA_ID="e2e-frobnicators-${E2E_RUN_UUID:0:8}"

prepare() {
  # Synthetic area + marker fact. Plausible workflow lineage: an
  # active workspace with the area linked, simulating an operator
  # who has just navigated to this area's domain.
  kb init area "$AREA_ID" "Frobnicators" \
    "Frobnicator calibration tolerances and field-replaceable assemblies"
  kb add fact "$AREA_ID" "${FROB_MARKER}: blue units are rated for 12.7 hertz with a 3% tolerance band." \
    --tags spec,calibration

  kb work create frob-demo "Frobnicator lookup" --areas "$AREA_ID"
  kb work start frob-demo
  kb work state \
    --phase "implementation" \
    --active "verifying frobnicator calibration tolerances"
  kb save
}

stimulate() {
  # Prompt names the tool, the area-id, and forbids fallback paths.
  # The "Do not use kb_search or kb_list" clause + paired assertions
  # apply the methodology gotcha from Cycle 5 (kb gotcha WmFjQOKa):
  # without it, a broken kb_load could be masked by the LLM falling
  # back to kb_search, which would also find the marker via the
  # area-metadata FTS path now in place.
  step "load-by-area-id" --prompt "Use ONLY the kb_load tool with area '${AREA_ID}'. Do not use kb_search or kb_list. Quote the entire matching fact verbatim in one line, including any text starting with 'FROB_MARKER'. Do not paraphrase."
}

observe() {
  # Tool path actually used.
  assert_tool_called    "kb_load"
  # No fallbacks — the marker must come through kb_load itself.
  assert_no_tool_calls  "kb_search"
  assert_no_tool_calls  "kb_list"
  # Marker reached the LLM via kb_load's result.
  assert_llm_contains   "$FROB_MARKER"
  assert_llm_contains_any "12.7" "hertz"
  assert_step_status_is "completed"
}
