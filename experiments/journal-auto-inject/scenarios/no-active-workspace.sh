# experiments/journal-auto-inject/scenarios/no-active-workspace.sh
#
# Negative case: with no active workspace, the journal-auto-inject hook
# must not surface journal entries from any workspace. The brain has
# workspaces with recent journals; if the renderer reaches into one
# without a "this is the active one" gate, the LLM would see context
# from a workspace the operator isn't actually in.

intent "No active workspace -> no journal entries leak into LLM context"

E2E_RUN_UUID="${E2E_RUN_UUID:-$(date -u +%s%N)}"
ORPHAN_MARKER="ORPHAN_${E2E_RUN_UUID}"

prepare() {
  # Create a workspace WITH a recent journal entry, then explicitly
  # deactivate. Realistic shape: an operator who finished a session
  # with `kb work stop`.
  kb work create orphan-demo "Orphaned-journal demo"
  kb work start orphan-demo
  kb work journal "Marker ${ORPHAN_MARKER}: in flight on the orphan feature."
  kb work stop
  kb save
}

stimulate() {
  # Reply with a single word — anything more open-ended makes the LLM
  # spiral on no-context state. The marker assertion still works against
  # a one-word answer (the orphan marker is 24+ characters).
  step "ask-recent" --prompt "Answer with a single word, yes or no: is there an active workspace?"
}

observe() {
  assert_llm_not_contains "$ORPHAN_MARKER"
  assert_step_status_is   "completed"
}
