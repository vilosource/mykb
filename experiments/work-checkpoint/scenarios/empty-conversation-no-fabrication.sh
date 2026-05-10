# experiments/work-checkpoint/scenarios/empty-conversation-no-fabrication.sh
#
# Negative control. The "conversation" being summarized has no
# milestone-worthy content — just chitchat / nothing. The LLM should
# emit `{}` (or all-empty fields). Checkpoint should report "nothing
# to update" and the workspace's journal.jsonl, area facts.jsonl,
# etc. should remain unchanged.
#
# Without this negative, a "fix" that always inserts a journal entry
# (or fabricates content from thin air) would still pass the positive
# scenarios. This guard catches that failure mode.

intent "LLM emits empty checkpoint when nothing happened; brain state unchanged"

E2E_RUN_UUID="${E2E_RUN_UUID:-$(date -u +%s%N)}"
WS_ID="e2e-checkpoint-${E2E_RUN_UUID:0:8}"
# Sentinel: if the LLM fabricates and writes to journal, this string
# will appear nowhere — we assert journal.jsonl stays absent or empty.
ANTI_MARKER="ANTI_FAB_${E2E_RUN_UUID}"

prepare() {
  kb work create "$WS_ID" "Checkpoint demo workspace"
  kb work start "$WS_ID"
  kb save
}

stimulate() {
  # Trivial conversation. The LLM is told to produce an empty
  # checkpoint when nothing is checkpoint-worthy.
  step "extract" --prompt "You are summarizing a session. Read this synthetic summary: <<< User said hi. Assistant said hi back. No work was done. >>> Produce a JSON object for 'kb work checkpoint'. If nothing in the conversation is worth recording, output exactly {} (an empty object). Do NOT invent journal entries, knowledge, or state changes. Output RAW JSON only — no markdown, no preamble. Do not use any tools. Do not include the string '${ANTI_MARKER}' anywhere."

  local raw json
  raw="$(jq -r '.result' "$SPIKE_LAST_STEP_FILE")"
  json="$(printf '%s' "$raw" | sed -E 's/^[[:space:]]*```(json)?[[:space:]]*//; s/[[:space:]]*```[[:space:]]*$//' | tr -d '\r')"
  printf '%s\n' "$json" > "$SPIKE_INSTANCE/.e2e-steps/$SPIKE_SCENARIO/checkpoint-payload.json"

  kb work checkpoint <<< "$json"
}

observe() {
  assert_no_tool_calls ""
  assert_step_status_is  "completed"
  # The anti-marker must NOT appear in the LLM output (proves the
  # prompt's negative instruction worked).
  assert_llm_not_contains "$ANTI_MARKER"

  # The journal.jsonl is either absent or empty — checkpoint with
  # an empty object should not have created entries. Same for
  # any area's facts.jsonl.
  if [[ -f "$SPIKE_INSTANCE/workspaces/$WS_ID/journal.jsonl" ]]; then
    if [[ -s "$SPIKE_INSTANCE/workspaces/$WS_ID/journal.jsonl" ]]; then
      _spike_assert_fail "journal.jsonl exists and is non-empty after empty checkpoint: $(cat "$SPIKE_INSTANCE/workspaces/$WS_ID/journal.jsonl")"
    else
      _spike_assert_pass
    fi
  else
    # No file = no fabrication. Pass.
    _spike_assert_pass
  fi
}
