# experiments/work-checkpoint/scenarios/knowledge-extraction.sh
#
# Integration regression guard. The conversation establishes a
# domain fact in a known area. The LLM emits {knowledge: [{type:
# 'fact', area, text}]} JSON. Checkpoint applies it. The area's
# facts.jsonl must contain the new entry with the marker.
#
# Where journal-extraction tests the simplest path (one string field),
# this scenario tests the most operationally important path: knowledge
# entries arriving in the brain via the LLM-as-extractor flow. If
# this regresses, every Claude Code session that uses `kb work
# checkpoint` to capture knowledge silently degrades.

intent "LLM emits knowledge JSON; brain area's facts.jsonl gains the entry"

E2E_RUN_UUID="${E2E_RUN_UUID:-$(date -u +%s%N)}"
WS_ID="e2e-checkpoint-${E2E_RUN_UUID:0:8}"
AREA_ID="e2e-frobnicators-${E2E_RUN_UUID:0:8}"
FACT_MARKER="FACT_${E2E_RUN_UUID}"

prepare() {
  # Synthetic area + workspace; the area is a real candidate for
  # the LLM to direct knowledge into.
  kb init area "$AREA_ID" "Frobnicators" \
    "Frobnicator calibration tolerances and field-replaceable assemblies"
  kb work create "$WS_ID" "Checkpoint demo workspace"
  kb work start "$WS_ID"
  kb save
}

stimulate() {
  # The conversation block names the area-id explicitly so the LLM
  # has zero ambiguity about where the fact belongs. The marker is
  # the load-bearing string.
  step "extract" --prompt "You are extracting durable knowledge from a session. Read this synthetic summary: <<< During the session we verified that the area '${AREA_ID}' has the following fact worth recording: '${FACT_MARKER}: blue frobnicator units operate at 12.7 hertz with a 3% tolerance band'. >>> Produce a JSON object for 'kb work checkpoint' that records this fact in the named area. Schema: {\"knowledge\": [{\"type\": \"fact\"|\"decision\"|\"gotcha\"|\"pattern\", \"area\": string, \"text\": string}]}. Output RAW JSON only — no markdown fences, no preamble, no explanation. The fact text MUST quote the marker '${FACT_MARKER}' verbatim. The area MUST be exactly '${AREA_ID}'. Do not use any tools."

  local raw json
  raw="$(jq -r '.result' "$SPIKE_LAST_STEP_FILE")"
  json="$(printf '%s' "$raw" | sed -E 's/^[[:space:]]*```(json)?[[:space:]]*//; s/[[:space:]]*```[[:space:]]*$//' | tr -d '\r')"
  printf '%s\n' "$json" > "$SPIKE_INSTANCE/.e2e-steps/$SPIKE_SCENARIO/checkpoint-payload.json"

  kb work checkpoint <<< "$json"
}

observe() {
  assert_no_tool_calls ""
  assert_llm_contains    "$FACT_MARKER"
  assert_step_status_is  "completed"

  # The area's facts.jsonl gained an entry with the marker.
  assert_branch_diff_contains "areas/$AREA_ID/facts.jsonl"

  if [[ ! -f "$SPIKE_INSTANCE/areas/$AREA_ID/facts.jsonl" ]]; then
    _spike_assert_fail "facts.jsonl missing for area $AREA_ID"
  elif ! grep -q "$FACT_MARKER" "$SPIKE_INSTANCE/areas/$AREA_ID/facts.jsonl"; then
    _spike_assert_fail "facts.jsonl exists but does not contain $FACT_MARKER"
  else
    _spike_assert_pass
  fi
}
