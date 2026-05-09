# experiments/journal-auto-inject/scenarios/mid-session-append.sh
#
# Per the DESIGN doc: before_agent_start fires on every turn, so a journal
# entry written between turn 1 and turn 2 should surface in turn 2's
# system prompt. This proves the per-turn re-injection contract isn't
# "frozen at session start" — a bug pattern that would silently degrade
# multi-turn workflows.

intent "Journal entry written mid-session is visible to the next turn's LLM"

E2E_RUN_UUID="${E2E_RUN_UUID:-$(date -u +%s%N)}"
MID_MARKER="MID_${E2E_RUN_UUID}"

prepare() {
  kb work create mid-demo "Mid-session-append demo"
  kb work start mid-demo
  kb work journal "started new feature: payment-flow"
  kb save
}

stimulate() {
  # Turn 1: anchor the session, ensure baseline context is in place.
  step "anchor" --prompt "What is my current workspace? Reply with just its name."

  # Operator (or in production, the LLM via kb_work_journal) appends a
  # new entry between turns.
  kb work journal "Marker ${MID_MARKER}: switched approach — using stripe-checkout instead of custom flow."

  # Turn 2: the new entry should surface in this turn's injected context.
  step "ask-latest" --prompt "Quote my most recent journal entry verbatim, including any reference IDs."
}

observe() {
  # The latest step is turn 2 — which is what SPIKE_LAST_STEP_FILE points at.
  assert_llm_contains    "$MID_MARKER"
  assert_step_status_is  "completed"
}
