# experiments/kb-list/scenarios/basic-list.sh
#
# Positive control. The LLM is told to use kb_list to enumerate areas
# and identify the one matching a topic keyword. Proves the tool is
# registered, callable, returns area metadata in a parseable shape,
# and the LLM can extract the area-id from the result.

intent "kb_list returns the area index; LLM cites a specific area-id from it"

E2E_RUN_UUID="${E2E_RUN_UUID:-$(date -u +%s%N)}"
AREA_ID="e2e-frobnicators-${E2E_RUN_UUID:0:8}"

prepare() {
  # Synthetic area whose summary contains a distinctive keyword.
  # No workspace setup (FYSqWj10 lesson — workspace block also lists
  # area-ids, which would let the LLM answer without kb_list).
  kb init area "$AREA_ID" "Frobnicators" \
    "Frobnicator calibration tolerances and field-replaceable assemblies"
  kb save
}

stimulate() {
  # Direct instruction. The kb_list NAMING IS A HAZARD: LLMs have
  # been observed to interpret `kb_list` as the shell-style command
  # `kb list` (underscore-as-separator), then call bash with
  # `kb list` instead of invoking the registered Pi tool. We
  # disambiguate explicitly: "registered Pi tool, not a shell
  # command", and ban bash. Forbid kb_search/kb_load so the LLM
  # stays on the area-listing path.
  step "list-and-pick" --prompt "Invoke the kb_list tool — this is a registered Pi tool that appears in your available-tools list, NOT a shell command. Do not run bash, do not run kb in a shell. The tool takes no parameters and returns the area index. Find the area-id whose summary mentions frobnicator calibration. Reply with exactly that area-id and nothing else. Do not use kb_search or kb_load."
}

observe() {
  # The tool path was actually used.
  assert_tool_called    "kb_list"
  # No accidental drift to entry-level tools.
  assert_no_tool_calls  "kb_search"
  assert_no_tool_calls  "kb_load"
  # The synthetic area-id reached the LLM via kb_list (or the
  # equivalent system-prompt rendering — both surfaces are a single
  # function and break together if renderAreaIndex regresses).
  assert_llm_contains   "$AREA_ID"
  assert_step_status_is "completed"
}
