# experiments/kb-list/scenarios/lists-tags-suffix.sh
#
# Load-bearing scenario for this experiment. Protects the
# `[tags: a, b]` suffix that renderAreaIndex emits for areas with
# non-empty tags. That suffix was added in Cycle 2 and is depended
# on by:
#   - kb_list output (this tool)
#   - <mykb-areas> system-prompt injection (same renderAreaIndex)
#   - LLM tag-based discovery in any scenario that has prepare()
#     create areas with --tags
#
# If the suffix regresses (formatting change, omission, separator
# drift), the LLM's ability to answer tag-based questions degrades
# silently. This scenario detects that surface.
#
# The setup gives multiple areas with different tags. The LLM is
# asked to find the area tagged with a distinctive keyword. Without
# the tags suffix in the kb_list output, the LLM cannot answer
# correctly from kb_list alone.

intent "kb_list output preserves the [tags: ...] suffix for tag-based area discovery"

E2E_RUN_UUID="${E2E_RUN_UUID:-$(date -u +%s%N)}"
TARGET_AREA="e2e-frobnicators-${E2E_RUN_UUID:0:8}"
DECOY_AREA="e2e-bobnicators-${E2E_RUN_UUID:0:8}"
DISTINCTIVE_TAG="zorblax${E2E_RUN_UUID:0:6}"

prepare() {
  # Two areas with similar names but distinct tags. The LLM must
  # use the tags suffix to disambiguate — a kb_list output without
  # tags would force a coin-flip between the two area-ids.
  kb init area "$TARGET_AREA" "Frobnicators" \
    "Hardware calibration domain" \
    --tags "$DISTINCTIVE_TAG,calibration"
  kb init area "$DECOY_AREA" "Bobnicators" \
    "Hardware calibration domain" \
    --tags decoy,calibration
  kb save
}

stimulate() {
  # Question can ONLY be answered via the tags suffix (both areas
  # have identical-looking summaries). The distinctive tag is unique
  # to TARGET_AREA, so the right answer is TARGET_AREA's id.
  # See basic-list.sh for the kb_list-vs-bash naming hazard rationale.
  step "find-by-tag" --prompt "Invoke the kb_list tool — this is a registered Pi tool that appears in your available-tools list, NOT a shell command. Do not run bash, do not run kb in a shell. The tool takes no parameters and returns the area index with each area's tags. Find the area-id whose tags include '${DISTINCTIVE_TAG}'. Reply with exactly that area-id and nothing else. Do not use kb_search or kb_load."
}

observe() {
  assert_tool_called    "kb_list"
  assert_no_tool_calls  "kb_search"
  assert_no_tool_calls  "kb_load"
  # Pinning the target — proves the LLM disambiguated via tags.
  assert_llm_contains   "$TARGET_AREA"
  # The decoy must NOT be cited — proves disambiguation, not just
  # any-area-with-similar-summary.
  assert_llm_not_contains "$DECOY_AREA"
  assert_step_status_is "completed"
}
