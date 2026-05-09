# experiments/area-scoring/scenarios/no-workspace-still-loads.sh
#
# Alternate-path positive: the workspace boost (+0.5 to linked areas)
# is a tie-breaker, not a gate — keyword scoring on signals must work
# with no active workspace. An operator who runs Pi without first
# starting a workspace should still benefit from area knowledge when
# their prompt matches an area's summary.
#
# The pairing here is "with workspace" (keyword-match-loads.sh) vs
# "without workspace" (this scenario). A regression where the scorer
# silently required an active workspace would degrade unwedged sessions.

intent "Keyword scoring loads areas even with no active workspace (linking is a boost, not a gate)"

E2E_RUN_UUID="${E2E_RUN_UUID:-$(date -u +%s%N)}"
WIDGET_MARKER="WIDGET_MARKER_${E2E_RUN_UUID}"
AREA_ID="e2e-widgets-${E2E_RUN_UUID:0:8}"

prepare() {
  kb init area "$AREA_ID" "Widgets" "Knowledge about widget calibration tolerances and frequencies"
  kb add fact "$AREA_ID" "Marker ${WIDGET_MARKER}: blue widgets are calibrated at 12.7 hertz with a 3% tolerance band." \
    --tags widget,calibration
  # Notably: NO workspace created or started. The area exists in the
  # brain; there's no workspace to link it from.
  kb save
}

stimulate() {
  # Force a verbatim quote of the fact's text (which contains the
  # WIDGET_MARKER). Asking for "reference ID" alone gets the LLM to
  # quote the area name instead. Asking for the full fact pins the
  # assertion.
  step "ask-spec" --prompt "Quote the entire fact about blue widget calibration verbatim, including any text that starts with 'Marker'. Reply in one line."
}

observe() {
  assert_llm_contains    "$WIDGET_MARKER"
  assert_step_status_is  "completed"
}
