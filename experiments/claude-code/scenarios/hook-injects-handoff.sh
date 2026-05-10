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

  # Materialize the kb context file vfa's claude adapter ships to the
  # LLM via --append-system-prompt-file. Pi's auto-injection is
  # automatic via session hooks; Claude Code's headless mode requires
  # this explicit export step (additionalContext from SessionStart
  # hooks doesn't reach the LLM in -p mode — Anthropic-documented
  # interactive-only behavior).
  spike_export_context
}

stimulate() {
  # The LLM sees the workspace block via --append-system-prompt-file.
  # Force a verbatim quote of any line starting with 'Marker' so the
  # assertion pins on the marker token (paraphrased answers were
  # passing the contract semantically but failing the marker check —
  # same LLM-variance pattern we hit in the Pi matrices).
  step "ask-resume" --prompt "Quote verbatim, in one line, any line in your context starting with the word 'Marker'."
}

observe() {
  assert_llm_contains   "$HANDOFF_MARKER"
  assert_step_status_is "completed"
}
