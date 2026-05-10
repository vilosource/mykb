# experiments/kb-search/scenarios/tool-no-match-no-fabrication.sh
#
# Negative control. When the LLM searches for a keyword that matches
# no entry (text, entry-tags) and no area metadata (summary,
# area-tags), kb_search returns "No matches" and the LLM does not
# fabricate the marker.
#
# Why this scenario exists:
#   The behavior matrix needs a paired negative for tool-finds-via-
#   area-metadata. Without it, a "fix" that returned ALL entries on
#   every query would still pass the positive scenarios. This guard
#   bounds the recall behavior from the other side.

intent "kb_search returns no matches and LLM does not fabricate when nothing matches"

E2E_RUN_UUID="${E2E_RUN_UUID:-$(date -u +%s%N)}"
FROB_MARKER="FROB_MARKER_${E2E_RUN_UUID}"
AREA_ID="e2e-frobnicators-${E2E_RUN_UUID:0:8}"
# A keyword that touches nothing — neither entry text/tags nor area
# summary/tags. Random nonce to avoid coincidental matches against
# specimen content if any leaked in.
NONSENSE_QUERY="zorblax_${E2E_RUN_UUID:0:8}"

prepare() {
  # Same shape as the positive scenarios but with a marker fact and
  # area metadata that don't mention the nonsense query.
  kb init area "$AREA_ID" "Frobnicators" \
    "Frobnicator calibration tolerances, drift coefficients, and field-replaceable assemblies" \
    --tags frobnicator,calibration
  kb add fact "$AREA_ID" "${FROB_MARKER}: blue units are rated for 12.7 hertz with a 3% tolerance band." \
    --tags spec,hertz

  kb work create frob-demo "Frobnicator lookup" --areas "$AREA_ID"
  kb work start frob-demo
  kb save
}

stimulate() {
  # Ask the LLM to search for the nonsense word and report the result
  # explicitly. Forbid fallback tools so the LLM can't use kb_load to
  # pull in the marker from the <mykb-areas> index when kb_search misses.
  step "search-no-match" --prompt "Use ONLY the kb_search tool with the query '${NONSENSE_QUERY}'. Do not use kb_load or kb_list. Report exactly what the tool returned. Do not include any other facts. If the tool reports no matches, say 'NO_MATCHES'."
}

observe() {
  # Tool path was used.
  assert_tool_called    "kb_search"
  assert_no_tool_calls  "kb_load"
  assert_no_tool_calls  "kb_list"
  # The marker fact must NOT appear — that would mean either kb_search
  # returned everything, or the LLM fabricated it from area-index
  # context. Either is a regression worth catching.
  assert_llm_not_contains "$FROB_MARKER"
  assert_step_status_is "completed"
}
