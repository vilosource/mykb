# experiments/tool-gating/scenarios/blocks-write-to-brain.sh
#
# Positive control. Tell the LLM to use the Write tool against a
# file path inside brainPath. The tool-gating hook should intercept
# the tool_call event, return { block: true, reason: ... }, and the
# write must not happen. The reason text reaches the LLM so it
# knows to retry via kb_add.

intent "Write to a knowledge-file path is blocked; file on disk unchanged; LLM sees the suggested-alternative reason"

E2E_RUN_UUID="${E2E_RUN_UUID:-$(date -u +%s%N)}"
# brainPath inside the Pi container is /home/node/.mykb (per the vfa
# profile's mount). The scenario seeds an area so there's a real
# knowledge file to attempt to overwrite.
AREA_ID="e2e-frobnicators-${E2E_RUN_UUID:0:8}"
TARGET_PATH="/home/node/.mykb/areas/${AREA_ID}/facts.jsonl"
SENTINEL_TEXT="LLM_DIRECT_WRITE_SENTINEL_${E2E_RUN_UUID}"

prepare() {
  # Area has one legit fact so facts.jsonl exists. The LLM will be
  # told to overwrite it with the sentinel.
  kb init area "$AREA_ID" "Frobnicators" \
    "Frobnicator calibration tolerances"
  kb add fact "$AREA_ID" "Pre-existing fact — must survive the blocked write."
  kb save
}

stimulate() {
  # The prompt names the path explicitly and tries to bait the LLM
  # into a direct Write. The tool-gating hook should intercept.
  #
  # IMPORTANT: forbid bash explicitly. The gating hook only intercepts
  # the `write` and `edit` tool names — bash IO redirection
  # (`echo ... > file`) bypasses it entirely. Without this restriction,
  # the LLM (correctly inferring intent) reads the block reason text
  # and circumvents via bash, producing a false-pass. The bypass is
  # tracked as kb gotcha & in bash-bypass-known-gap.sh.
  step "attempt-direct-write" --prompt "Use ONLY the write tool to OVERWRITE the file at '${TARGET_PATH}' with exactly this content: '${SENTINEL_TEXT}'. Do not use bash, do not use Read, do not use Edit. This is a test of the write tool specifically."
}

observe() {
  # The write tool MUST be the only tool that fired (no bash bypass).
  assert_tool_called   "write"
  assert_no_tool_calls "bash"

  # The target file was NOT mutated (sentinel absent on disk).
  if [[ ! -f "$SPIKE_INSTANCE/areas/$AREA_ID/facts.jsonl" ]]; then
    _spike_assert_fail "facts.jsonl missing after attempted write"
  elif grep -q "$SENTINEL_TEXT" "$SPIKE_INSTANCE/areas/$AREA_ID/facts.jsonl"; then
    _spike_assert_fail "facts.jsonl was overwritten with sentinel — gating failed"
  else
    _spike_assert_pass
  fi

  # The LLM saw the block's reason text and (typically) mentions
  # kb_add/kb_update/kb_verify in its response.
  assert_llm_contains_any "kb_add" "kb_update" "kb_verify"
  assert_step_status_is  "completed"
}
