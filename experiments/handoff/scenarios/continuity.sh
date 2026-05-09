# experiments/handoff/scenarios/continuity.sh
#
# Probes that a handoff written in a prior "session" is visible to the
# LLM at the start of a fresh session — the core continuity contract.
#
# Plausible workflow lineage in prepare(): create a workspace, set state
# to mid-task, write a couple of journal entries representing prior
# milestones, add a fact, then write the handoff that summarizes where
# things stand. The handoff has content because there's work for it
# to summarize.
#
# The marker (E2E_RUN_UUID) is unique per run so a stale instance from
# a previous run can't accidentally satisfy this run's assertion.

intent "Fresh session sees prior handoff and can describe where work was left off"

E2E_RUN_UUID="${E2E_RUN_UUID:-$(date -u +%s%N)}"

prepare() {
  kb work create handoff-demo "Handoff continuity demo"
  kb work start handoff-demo
  kb work state \
    --phase "implementation" \
    --active "wiring up the auth middleware" \
    --next "write rate-limiter tests"
  kb work journal "scaffolded the auth middleware module"
  kb work journal "added password hashing with argon2"
  kb work handoff "Auth middleware module ${E2E_RUN_UUID} is half-done. Next session should focus on wiring rate-limiter tests against the existing harness — see test/auth-middleware.test.ts for the pattern."
  kb save
}

stimulate() {
  step "ask-resume" --prompt "I'm picking up where I left off. What were we doing, and what's the next concrete step?"
}

observe() {
  # The LLM should surface the unique marker — proves it read the handoff,
  # not some unrelated cached context.
  assert_llm_contains "$E2E_RUN_UUID"

  # Topical: the LLM should mention what we were working on and what's next.
  assert_llm_contains_any "auth" "middleware" "rate-limiter"

  assert_step_status_is "completed"
}
