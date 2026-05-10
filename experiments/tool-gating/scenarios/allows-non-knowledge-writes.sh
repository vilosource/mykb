# experiments/tool-gating/scenarios/allows-non-knowledge-writes.sh
#
# Negative control. The gating hook MUST be precise — it blocks
# only knowledge files, not arbitrary writes. Without this scenario,
# a "block everything" regression would still pass the positive
# scenarios while breaking every workflow that uses Write/Edit
# legitimately (notes, scratch files, anything outside the brain).

intent "Write to /tmp/note.md (non-knowledge path, non-knowledge extension) is NOT blocked"

E2E_RUN_UUID="${E2E_RUN_UUID:-$(date -u +%s%N)}"
# /tmp inside the Pi container, .md extension — not in brainPath,
# not a *.jsonl/area.json/manifest.json pattern. Should pass through.
TARGET_PATH="/tmp/scratch-note-${E2E_RUN_UUID:0:8}.md"
SENTINEL_TEXT="LEGITIMATE_WRITE_${E2E_RUN_UUID}"

prepare() {
  kb work create "e2e-gate-${E2E_RUN_UUID:0:8}" "Tool-gating demo"
  kb work start "e2e-gate-${E2E_RUN_UUID:0:8}"
  kb save
}

stimulate() {
  step "attempt-legit-write" --prompt "Use the write tool to create a file at '${TARGET_PATH}' with this exact content: '${SENTINEL_TEXT}'. This is a normal scratch file; you should be able to write it without restriction."
}

observe() {
  # The write tool was called. (Inside-container /tmp isn't visible
  # on the host, so we can't grep the file. The signal that the
  # gating did NOT fire is: the write tool was called AND its
  # result is the LLM's own confirmation, not the gating reason.)
  assert_tool_called "write"

  # The LLM's response must NOT mention the gating reason text —
  # that would indicate the block fired when it shouldn't have.
  # The block's reason text starts with "Do not edit knowledge
  # files directly" — its absence is the precision-check.
  assert_llm_not_contains "Do not edit knowledge files"
  assert_step_status_is   "completed"
}
