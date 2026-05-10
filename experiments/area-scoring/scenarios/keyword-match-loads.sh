# experiments/area-scoring/scenarios/keyword-match-loads.sh
#
# Positive control: when the prompt's keywords match an area's
# summary/tags, the area's entries should reach the LLM. We assert this
# by embedding a unique marker in the area's only fact and checking the
# LLM cites it. This proves the full chain: signal capture → scoring
# → entry selection → system-message injection → LLM read it.

intent "Keyword overlap loads area entries; LLM cites the marker fact"

E2E_RUN_UUID="${E2E_RUN_UUID:-$(date -u +%s%N)}"
WIDGET_MARKER="WIDGET_MARKER_${E2E_RUN_UUID}"
AREA_ID="e2e-widgets-${E2E_RUN_UUID:0:8}"

prepare() {
  # Synthetic area with a marker fact. Summary contains the keywords
  # that the prompt will match: "widget calibration". Without those
  # words in summary/tags, the keyword scorer would give zero overlap
  # and the area wouldn't load.
  kb init area "$AREA_ID" "Widgets" "Knowledge about widget calibration tolerances and frequencies"
  kb add fact "$AREA_ID" "Marker ${WIDGET_MARKER}: blue widgets are calibrated at 12.7 hertz with a 3% tolerance band." \
    --tags widget,calibration

  # Plausible workflow lineage: a workspace where the operator is
  # working on something widget-related, with this area linked.
  kb work create widgets-demo "Widget calibration demo" --areas "$AREA_ID"
  kb work start widgets-demo
  kb work state \
    --phase "implementation" \
    --active "verifying calibration spec for blue widgets"
  kb save
}

stimulate() {
  step "ask-spec" --prompt "Quote the entire fact about blue widget calibration verbatim, including any text that starts with 'Marker'. Reply in one line."
}

observe() {
  assert_llm_contains    "$WIDGET_MARKER"
  assert_llm_contains_any "12.7" "hertz"
  assert_step_status_is  "completed"
}
