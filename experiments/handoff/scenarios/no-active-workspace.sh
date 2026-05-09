# experiments/handoff/scenarios/no-active-workspace.sh
#
# The negative paired with continuity.sh: when there is NO active
# workspace, no handoff block should appear in the LLM's context — even
# if there are workspaces in the brain that have handoffs.
#
# Without this scenario, a regression where the handoff renderer reaches
# into a non-active workspace and surfaces stale context would slip
# through every other test.

intent "No active workspace -> no handoff content surfaces, even when brain has workspaces with handoffs"

E2E_RUN_UUID="${E2E_RUN_UUID:-$(date -u +%s%N)}"
DORMANT_MARKER="DORMANT_${E2E_RUN_UUID}"

prepare() {
  # Create a workspace + handoff, then explicitly deactivate. This is
  # the realistic shape: an operator who just finished a session with
  # 'kb work stop'.
  kb work create dormant-demo "Dormant demo"
  kb work start dormant-demo
  kb work journal "wrapped up the dormant project"
  kb work handoff "Marker ${DORMANT_MARKER}: dormant project paused; resume only if priorities shift."
  kb work stop
  kb save
}

stimulate() {
  step "ask-resume" --prompt "Am I in the middle of any work? Quote any unique markers you find verbatim."
}

observe() {
  # The dormant marker must NOT leak into context.
  assert_llm_not_contains "$DORMANT_MARKER"
  assert_step_status_is "completed"
}
