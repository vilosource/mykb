# experiments/tool-gating/scenarios/blocks-edit-by-pattern.sh
#
# Positive control #2 — uses the FILENAME-PATTERN branch of the
# gating logic instead of the brainPath-prefix branch. The hook
# blocks any Edit on a `*.jsonl` file, even when the file is
# outside brainPath. Catches the case where someone copied a
# knowledge file out of the brain and the LLM tries to edit the
# copy directly.

intent "Edit on a *.jsonl file outside brainPath is still blocked by filename pattern"

E2E_RUN_UUID="${E2E_RUN_UUID:-$(date -u +%s%N)}"
# /tmp inside the Pi container is writable but NOT inside brainPath
# (brainPath is /home/node/.mykb). The .jsonl filename triggers the
# pattern branch.
TARGET_PATH="/tmp/extracted-facts-${E2E_RUN_UUID:0:8}.jsonl"
SENTINEL_TEXT="JSONL_PATTERN_SENTINEL_${E2E_RUN_UUID}"

prepare() {
  # No brain setup needed — the test is about filename pattern, not
  # brain state. We DO need an active workspace so the session
  # starts cleanly though.
  kb work create "e2e-gate-${E2E_RUN_UUID:0:8}" "Tool-gating demo"
  kb work start "e2e-gate-${E2E_RUN_UUID:0:8}"
  kb save
}

stimulate() {
  # Bait the LLM into a Write to a .jsonl path outside brainPath.
  # The hook should block on the .jsonl extension pattern alone.
  # Forbid bash to prevent the same bypass as blocks-write-to-brain.
  #
  # Tell the LLM to passive-relay any error verbatim. Without this,
  # some LLMs hallucinate success even when the tool returned an
  # error — blocking us from asserting on the reason text in the
  # LLM's response.
  step "attempt-jsonl-write" --prompt "Use ONLY the write tool to create a file at '${TARGET_PATH}' with this exact content: '{\"sentinel\":\"${SENTINEL_TEXT}\"}'. Do not use bash, do not use edit. If the write tool returns an error, reply with EXACTLY the error message text and nothing else. Do not claim success if the tool errored."
}

observe() {
  # The write tool was the only tool — no bash bypass.
  assert_tool_called   "write"
  assert_no_tool_calls "bash"

  # Strongest pass: the write was blocked, no file exists. (Inside-
  # container /tmp is ephemeral, so checking the path on the host
  # doesn't work — we rely on tool-call inspection + LLM transcript.)
  # The LLM's reaction to the block's reason text is the signal that
  # the gating fired: it should mention the suggested kb_* tools.
  assert_llm_contains_any "kb_add" "kb_update" "kb_verify"
  assert_step_status_is  "completed"
}
