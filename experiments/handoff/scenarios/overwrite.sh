# experiments/handoff/scenarios/overwrite.sh
#
# Probes that a second handoff replaces the first — the LLM should only
# see the most recent text, never the stale one. Without this contract,
# operators who update their handoff mid-session would risk the LLM
# citing outdated context after compaction.

intent "Second handoff overwrites the first; LLM sees only the second"

E2E_RUN_UUID="${E2E_RUN_UUID:-$(date -u +%s%N)}"
STALE_MARKER="STALE_${E2E_RUN_UUID}"
FRESH_MARKER="FRESH_${E2E_RUN_UUID}"

prepare() {
  kb work create overwrite-demo "Overwrite demo"
  kb work start overwrite-demo
  kb work journal "started exploring auth options"

  # First handoff — the one that should NOT survive.
  kb work handoff "Marker ${STALE_MARKER}: investigating OAuth2 flows; next session pick the library."

  # ... time passes, we made progress, write a new handoff ...
  kb work journal "decided on passport-oauth2"

  # Second handoff — the one the LLM SHOULD see.
  kb work handoff "Marker ${FRESH_MARKER}: passport-oauth2 chosen; next session wire it into the auth middleware."
  kb save
}

stimulate() {
  step "ask-handoff" --prompt "Quote my workspace handoff verbatim (including any reference IDs), then state the single next concrete step."
}

observe() {
  assert_llm_contains    "$FRESH_MARKER"
  assert_llm_not_contains "$STALE_MARKER"
  assert_step_status_is "completed"
}
