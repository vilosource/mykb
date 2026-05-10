# experiments/claude-code/scenarios/bare-runs.sh
#
# Smoke check for the harness's claude-code runtime support. No kb
# interaction; just confirms vfa --provider zai-glm starts the
# container, the LLM responds, and the step JSON parses cleanly.
#
# A failure here means the runtime/provider/profile combination is
# broken at the harness level, before any mykb-specific behavior
# can be tested.

intent "Harness can drive claude-code (provider zai-glm) end-to-end"

prepare() {
  : # No state — this is a pure runtime smoke.
}

stimulate() {
  step "smoke" --prompt "Reply with exactly the word 'ready' (no other text)."
}

observe() {
  assert_llm_contains   "ready"
  assert_step_status_is "completed"
}
