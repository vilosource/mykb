# experiments/journal-auto-inject/scenarios/resume-continuity.sh
#
# The positive case: a journal entry written today should surface in
# the LLM's view of recent work when a fresh session starts. This is
# the core continuity contract.

intent "Recent journal entry surfaces in fresh-session LLM context"

E2E_RUN_UUID="${E2E_RUN_UUID:-$(date -u +%s%N)}"

prepare() {
  kb work create journal-demo "Journal continuity demo"
  kb work start journal-demo
  kb work state \
    --phase "implementation" \
    --active "wiring up rate-limiter middleware" \
    --next "add integration tests"

  # Plausible workflow lineage: a couple of routine entries, then the
  # unique-marker entry that proves auto-injection actually fired.
  kb work journal "scaffolded the rate-limiter middleware"
  kb work journal "added passport-oauth2 integration"
  kb work journal "Marker ${E2E_RUN_UUID}: blocked on token-refresh logic; resume by reading test/oauth2.test.ts"
  kb save
}

stimulate() {
  step "ask-recent" --prompt "Quote my most recent journal entry verbatim, including any reference IDs."
}

observe() {
  assert_llm_contains    "$E2E_RUN_UUID"
  assert_llm_contains_any "rate-limiter" "passport-oauth2" "token-refresh"
  assert_step_status_is  "completed"
}
