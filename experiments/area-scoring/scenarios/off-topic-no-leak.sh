# experiments/area-scoring/scenarios/off-topic-no-leak.sh
#
# Negative control paired with keyword-match-loads. The same area exists
# (with the same marker fact and summary), the same workspace links it
# — but the prompt is about an unrelated topic (basic arithmetic). The
# scorer should give zero overlap, the entry should not be injected,
# and the LLM's answer should not mention the marker.
#
# Without this paired negative, a regression where every prompt loaded
# every area would still pass keyword-match-loads.

intent "Off-topic prompt does not surface area-marker fact"

E2E_RUN_UUID="${E2E_RUN_UUID:-$(date -u +%s%N)}"
WIDGET_MARKER="WIDGET_MARKER_${E2E_RUN_UUID}"
AREA_ID="e2e-widgets-${E2E_RUN_UUID:0:8}"

prepare() {
  kb init area "$AREA_ID" "Widgets" "Knowledge about widget calibration tolerances and frequencies"
  kb add fact "$AREA_ID" "Marker ${WIDGET_MARKER}: blue widgets are calibrated at 12.7 hertz with a 3% tolerance band." \
    --tags widget,calibration
  kb work create widgets-demo "Widget calibration demo" --areas "$AREA_ID"
  kb work start widgets-demo
  kb save
}

stimulate() {
  # Pure arithmetic — no signal-overlap with widget area's summary/tags
  # ("widget", "calibration", "tolerances", "frequencies").
  step "ask-arith" --prompt "Answer with just the number: what is 17 plus 24?"
}

observe() {
  # Marker MUST be absent from the LLM's reply.
  assert_llm_not_contains "$WIDGET_MARKER"
  assert_step_status_is   "completed"
}
