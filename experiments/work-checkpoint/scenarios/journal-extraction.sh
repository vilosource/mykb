# experiments/work-checkpoint/scenarios/journal-extraction.sh
#
# Positive control. Synthetic conversation describes a clear
# milestone-worthy event with a unique marker. The LLM is told to
# emit `{journal: "..."}` JSON. The harness pipes that JSON to
# `kb work checkpoint`. The workspace's journal.jsonl should then
# contain the marker.
#
# Tests the full chain: prompt → LLM → JSON → pipe → checkpoint
# storage method → JSONL. Any single link broken drops the marker.

intent "LLM emits checkpoint JSON from conversation; journal.jsonl gains the marker"

E2E_RUN_UUID="${E2E_RUN_UUID:-$(date -u +%s%N)}"
WS_ID="e2e-checkpoint-${E2E_RUN_UUID:0:8}"
JOURNAL_MARKER="JOURNAL_${E2E_RUN_UUID}"

prepare() {
  # Synthetic workspace. No LLM in this phase — just brain mutation.
  kb work create "$WS_ID" "Checkpoint demo workspace"
  kb work start "$WS_ID"
  kb save
}

stimulate() {
  # The prompt embeds a synthetic "conversation summary" the LLM must
  # extract from. The marker is the load-bearing string — we'll
  # assert it lands in the journal entry.
  #
  # Tool restrictions: no bash, no Read, no Write, no kb_* tools.
  # The LLM must answer from the prompt content alone. assert_no_
  # tool_calls "" enforces this.
  step "extract" --prompt "You are summarizing a session. Read this synthetic summary block: <<< Session activity: completed implementation of the frobnicator calibration routine; ${JOURNAL_MARKER}: shipped commit abc123 verifying blue-unit tolerances at 12.7 hertz. Tests pass 17/17. >>> Now produce a JSON object that, when piped to 'kb work checkpoint', will record this milestone in the active workspace's journal. The schema is: {\"journal\": string, \"handoff\": string, \"state\": object, \"knowledge\": array} — all fields optional. For this task ONLY a journal field is appropriate. Output RAW JSON only, no markdown fences, no explanation, no preamble. The journal value MUST quote the marker '${JOURNAL_MARKER}' verbatim. Do not use any tools."

  # Extract LLM output (the JSON). Defensively strip any markdown
  # code fences a borderline LLM might still emit despite the
  # instruction. Then pipe through `kb work checkpoint`.
  local raw json
  raw="$(jq -r '.result' "$SPIKE_LAST_STEP_FILE")"
  json="$(printf '%s' "$raw" | sed -E 's/^[[:space:]]*```(json)?[[:space:]]*//; s/[[:space:]]*```[[:space:]]*$//' | tr -d '\r')"
  # Record what we attempted to pipe — useful if the assertion fails
  # and the operator wants to inspect via `kb-spike diff`.
  printf '%s\n' "$json" > "$SPIKE_INSTANCE/.e2e-steps/$SPIKE_SCENARIO/checkpoint-payload.json"

  kb work checkpoint <<< "$json"
}

observe() {
  # No tool calls of any kind during the extraction step.
  assert_no_tool_calls ""

  # The LLM's output (the JSON) must have contained the marker —
  # otherwise the journal write would lack it.
  assert_llm_contains    "$JOURNAL_MARKER"
  assert_step_status_is  "completed"

  # The brain state changed: the workspace's journal.jsonl now
  # contains an entry whose text includes the marker. This is the
  # ultimate proof that the LLM-as-extractor chain delivered.
  assert_branch_diff_contains "workspaces/$WS_ID/journal.jsonl"

  # Direct check: read the file and confirm marker text. Belt-and-
  # suspenders against `branch_diff_contains` matching only the
  # path (file might exist but not contain the marker if checkpoint
  # silently lost it).
  if [[ ! -f "$SPIKE_INSTANCE/workspaces/$WS_ID/journal.jsonl" ]]; then
    _spike_assert_fail "journal.jsonl missing for workspace $WS_ID"
  elif ! grep -q "$JOURNAL_MARKER" "$SPIKE_INSTANCE/workspaces/$WS_ID/journal.jsonl"; then
    _spike_assert_fail "journal.jsonl exists but does not contain $JOURNAL_MARKER"
  else
    _spike_assert_pass
  fi
}
