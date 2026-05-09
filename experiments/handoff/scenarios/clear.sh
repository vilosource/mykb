# experiments/handoff/scenarios/clear.sh
#
# Probes that `kb work handoff --clear` actually disappears the handoff
# from LLM context. If the handoff lingered after clearing, the next
# session would silently pick up stale steering — the kind of bug the
# methodology is built to catch.

intent "kb work handoff --clear removes the handoff from LLM context"

E2E_RUN_UUID="${E2E_RUN_UUID:-$(date -u +%s%N)}"
CLEARED_MARKER="CLEARED_${E2E_RUN_UUID}"

prepare() {
  kb work create clear-demo "Clear demo"
  kb work start clear-demo
  kb work journal "set up the project skeleton"
  kb work handoff "Marker ${CLEARED_MARKER}: in the middle of refactoring the payment flow; next session continue."

  # Operator decides the handoff was wrong (or no longer relevant).
  kb work handoff --clear
  kb save
}

stimulate() {
  step "ask-handoff" --prompt "Reply in one short sentence: do I have a workspace handoff right now? If yes, quote its first 20 characters verbatim."
}

observe() {
  assert_llm_not_contains "$CLEARED_MARKER"
  assert_step_status_is "completed"
}
