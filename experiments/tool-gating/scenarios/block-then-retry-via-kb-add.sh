# experiments/tool-gating/scenarios/block-then-retry-via-kb-add.sh
#
# Integration anchor. Proves the full gating workflow: LLM tries
# direct Write → blocked → LLM reads the reason text → LLM retries
# via the suggested kb_add tool → fact lands in the area's
# facts.jsonl via the proper path.
#
# Without this scenario, the positive (blocked) and negative
# (precise) scenarios bound the gating from both sides — but neither
# proves the LLM actually understands and acts on the suggestion.
# This is what makes tool-gating useful in practice rather than just
# annoying.

intent "Blocked Write → LLM retries via kb_add → fact lands in the right area"

E2E_RUN_UUID="${E2E_RUN_UUID:-$(date -u +%s%N)}"
AREA_ID="e2e-frobnicators-${E2E_RUN_UUID:0:8}"
TARGET_PATH="/home/node/.mykb/areas/${AREA_ID}/facts.jsonl"
FACT_MARKER="RETRY_MARKER_${E2E_RUN_UUID}"

prepare() {
  kb init area "$AREA_ID" "Frobnicators" \
    "Frobnicator calibration tolerances"
  kb save
}

stimulate() {
  # The prompt invites the LLM to try Write first, then accept the
  # block and retry via kb_add. We explicitly say "if blocked, use
  # the suggested alternative" — otherwise some LLMs give up after
  # the first block.
  step "block-then-retry" --prompt "Record this fact in the '${AREA_ID}' area: '${FACT_MARKER}: blue units are rated at 12.7 hertz'. Try the write tool against '${TARGET_PATH}' first. If the write is blocked, use the suggested alternative tool (kb_add) to record the fact properly. The fact MUST end up persisted in the area."
}

observe() {
  # The kb_add tool fired (proves the retry path took).
  assert_tool_called "kb_add"

  # The marker landed in facts.jsonl via the proper path.
  if [[ ! -f "$SPIKE_INSTANCE/areas/$AREA_ID/facts.jsonl" ]]; then
    _spike_assert_fail "facts.jsonl missing after kb_add retry"
  elif ! grep -q "$FACT_MARKER" "$SPIKE_INSTANCE/areas/$AREA_ID/facts.jsonl"; then
    _spike_assert_fail "facts.jsonl exists but marker not present — kb_add didn't write"
  else
    _spike_assert_pass
  fi

  assert_step_status_is "completed"
}
