# experiments/kb-search/scenarios/tool-direct-text-match.sh
#
# Positive control / sanity baseline: when the LLM searches for a word
# that appears in an entry's text, kb_search returns the entry and the
# LLM cites the marker. This proves the basic FTS path works end-to-end
# (tool registered, captured CLI fires, FTS5 matches, markdown rendered,
# LLM read the result). Without this scenario passing, any failure of
# tool-finds-via-area-metadata is ambiguous.
#
# Together with tool-finds-via-area-metadata and tool-no-match-no-fabrication,
# this triple bounds kb_search's behavior:
#   - direct-text-match  : entry-text path works
#   - finds-via-area-metadata : area-metadata path works
#   - no-match-no-fabrication : LLM doesn't make up the marker on cold misses

intent "kb_search returns entries when the query matches entry text"

E2E_RUN_UUID="${E2E_RUN_UUID:-$(date -u +%s%N)}"
FROB_MARKER="FROB_MARKER_${E2E_RUN_UUID}"
AREA_ID="e2e-frobnicators-${E2E_RUN_UUID:0:8}"

prepare() {
  # Synthetic area whose summary is intentionally generic. The marker
  # word lives in the entry text — that is the path under test here.
  kb init area "$AREA_ID" "Equipment" "Specifications and tolerances for benchtop hardware"
  kb add fact "$AREA_ID" "${FROB_MARKER}: blue units are rated for 12.7 hertz with a 3% tolerance band." \
    --tags spec,calibration

  # Plausible workflow lineage: an active workspace where the operator
  # is consulting the brain about hardware specs.
  kb work create equipment-demo "Equipment lookup" --areas "$AREA_ID"
  kb work start equipment-demo
  kb work state \
    --phase "implementation" \
    --active "looking up calibration spec for blue units"
  kb save
}

stimulate() {
  # Sharp single-turn prompt that should drive the LLM to call kb_search.
  # We forbid kb_load/kb_list explicitly so the assertion below proves
  # the marker came from kb_search's result, not from a fallback.
  step "search-by-marker" --prompt "Use ONLY the kb_search tool to look up '${FROB_MARKER}' in the knowledge base. Do not use kb_load or kb_list. Quote the entire matching fact verbatim in one line, including the marker."
}

observe() {
  # The tool path was actually used (not a fallback).
  assert_tool_called    "kb_search"
  assert_no_tool_calls  "kb_load"
  assert_no_tool_calls  "kb_list"
  # The marker reached the LLM through kb_search's result.
  assert_llm_contains   "$FROB_MARKER"
  assert_llm_contains_any "12.7" "hertz"
  assert_step_status_is "completed"
}
