# experiments/claude-code/scenarios/hook-injects-handoff.sh
#
# The real test: with SessionStart hook configured (via
# .claude/settings.json + hooks/session-start.sh in the workdir-seed),
# Claude+GLM cites the workspace handoff at session begin WITHOUT
# being asked anything kb-related.
#
# Pre-hook (to verify the test detects the absence): a profile that
# doesn't mount the workdir-seed gives Claude no hook config, so the
# handoff doesn't reach the LLM. The marker assertion fails. After
# the hook is wired, the marker assertion passes.

intent "SessionStart hook surfaces workspace handoff to Claude+GLM at session begin"

E2E_RUN_UUID="${E2E_RUN_UUID:-$(date -u +%s%N)}"
HANDOFF_MARKER="HANDOFF_MARKER_${E2E_RUN_UUID}"

prepare() {
  kb work create claude-demo "Claude continuity demo"
  kb work start claude-demo
  kb work state \
    --phase "implementation" \
    --active "wiring up rate-limiter middleware"
  kb work journal "scaffolded the rate-limiter module"
  kb work handoff "Marker ${HANDOFF_MARKER}: rate-limiter half-done; next session continue with token-bucket logic."
  kb save
}

stimulate() {
  # The prompt deliberately doesn't mention kb, handoff, workspace, or
  # any related concepts. If the LLM cites the marker, it must have
  # come in via the hook's additionalContext at session begin —
  # nothing else surfaces it.
  step "ask-resume" --prompt "Hi. Brief one-line answer: what was I last working on, and what's the next step?"
}

observe() {
  assert_llm_contains   "$HANDOFF_MARKER"
  assert_step_status_is "completed"
}
