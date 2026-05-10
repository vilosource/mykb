# experiments/kb-list/scenarios/no-match-no-fabrication.sh
#
# Negative control. The LLM uses kb_list and is asked about a topic
# that doesn't match any existing area. The expected answer is "no
# matching area found" — the LLM must NOT fabricate an area-id.
#
# Catches two regression modes:
#   - kb_list returning content that looks like real areas when none
#     match (e.g., if rendering ever leaks placeholder rows).
#   - LLM-level hallucination of synthetic-shaped area-ids when
#     given a topic question. A correctly-functioning kb_list
#     answer should ground the LLM, not push it to invent.

intent "kb_list returns the catalog; LLM does not fabricate areas for missing topics"

E2E_RUN_UUID="${E2E_RUN_UUID:-$(date -u +%s%N)}"
EXISTING_AREA="e2e-frobnicators-${E2E_RUN_UUID:0:8}"
# A topic word designed to NOT appear in any area. Per-run nonce so
# specimen content can't accidentally match.
NONSENSE_TOPIC="zorblax_${E2E_RUN_UUID:0:8}"

prepare() {
  # One real area so kb_list has something to return — but its
  # content does not match the nonsense topic.
  kb init area "$EXISTING_AREA" "Frobnicators" \
    "Frobnicator calibration tolerances"
  kb save
}

stimulate() {
  # Tell the LLM exactly what topic to look for and instruct it to
  # report a structured no-match answer. Forbid entry-level tools
  # so it stays on the area-listing path. See basic-list.sh for the
  # kb_list-vs-bash naming hazard rationale.
  step "list-and-miss" --prompt "Invoke the kb_list tool — this is a registered Pi tool that appears in your available-tools list, NOT a shell command. Do not run bash, do not run kb in a shell. The tool takes no parameters and returns the area index. Find an area-id whose summary or tags mention '${NONSENSE_TOPIC}'. If none match, reply with exactly 'NO_MATCHING_AREA' and nothing else. Do not invent an area-id. Do not use kb_search or kb_load."
}

observe() {
  assert_tool_called    "kb_list"
  assert_no_tool_calls  "kb_search"
  assert_no_tool_calls  "kb_load"
  # The LLM must NOT cite the existing area (it doesn't match the
  # topic). It must also NOT invent a fake area-id with the e2e-
  # pattern; we can't enumerate all hallucinations, but pinning the
  # known-existing one is the load-bearing check — fabrication
  # would most likely take the form of "the area for X is e2e-..."
  # using the existing area as a template.
  assert_llm_not_contains "$EXISTING_AREA"
  assert_step_status_is "completed"
}
