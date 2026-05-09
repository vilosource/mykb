# experiments/area-scoring/scenarios/scoring-without-tools.sh
#
# v2 scenario for area-scoring: prove the system-prompt area index is
# visible to the LLM even when no kb tools (kb_list, kb_search, etc.)
# are registered. Pairs with kb-list-shows-tags.sh to bound the
# discoverability surface from both sides:
#   kb-list-shows-tags: tools-on, prove the LLM can find an area by tag
#                       via the kb_list tool (or via area-index — same
#                       data, two paths).
#   scoring-without-tools (this): tools-off, prove the area-index
#                       channel still surfaces area metadata.
#
# Mechanism:
#   1. The scenario sets SPIKE_DISABLE_TOOLS=1 in its environment.
#   2. step() reads that and passes '--env MYKB_DISABLE_TOOLS=1' to vfa.
#   3. The kb extension reads MYKB_DISABLE_TOOLS and skips registerTools().
#   4. The LLM has only the system prompt (area index in <mykb-areas>,
#      workspace block in <mykb-workspace>) and the per-turn context
#      block (when scoring fires).
#   5. The LLM is asked to identify an area by its summary keywords —
#      data that's always in the area index regardless of scoring.
#
# Why not assert on the marker fact (scoring-isolated):
#   The per-turn `context` hook fires before the `input` event has
#   seeded signals on the first turn — Pi event-ordering observation
#   discovered while iterating this scenario. So mykb-context is empty
#   on first turn. Multi-turn scenarios accumulate signals via prior
#   user inputs but Pi's runtime tools (bash, Read) give the LLM
#   enough rope to spiral when a tighter answer was available. A
#   genuinely scoring-isolated test would need Pi's runtime tools
#   suppressed too — out of scope for v2 here.
#
# Two assertions:
#   - assert_no_tool_calls (kb_ prefix): no kb_search/kb_list/kb_load
#     fired (proves the disable knob took effect; Pi runtime tools
#     like bash that fire are filtered out).
#   - assert_llm_contains AREA_ID: the area index made it to the LLM,
#     proving the <mykb-areas> system-prompt path works without tools.

intent "Area index in system prompt is visible to LLM even without kb tools"

# Make this scenario's step honor the disable. step() reads this and
# threads --env MYKB_DISABLE_TOOLS=1 to vfa. The bundle reads the env
# and skips registerTools().
export SPIKE_DISABLE_TOOLS=1

E2E_RUN_UUID="${E2E_RUN_UUID:-$(date -u +%s%N)}"
AREA_ID="e2e-widgets-${E2E_RUN_UUID:0:8}"

prepare() {
  kb init area "$AREA_ID" "Widgets" "Knowledge about widget calibration tolerances and frequencies"
  kb add fact "$AREA_ID" "Blue widgets are calibrated at 12.7 hertz with a 3% tolerance band."
  kb save
}

stimulate() {
  # Sharp single-turn prompt that points the LLM at the system-prompt
  # area index. Without kb tools and with a clear instruction, the LLM
  # quotes the area-id from its <mykb-areas> block. Looser phrasing
  # let the LLM go bash-hunting and time out.
  step "ask-area-id" --prompt "Look at the <mykb-areas> section of your system context. Reply with exactly one area-id (no other text): the area whose summary mentions widget calibration."
}

observe() {
  # No kb_* tool fired. Pi runtime tools (bash, Read, Write) are
  # ignored by default — the disable knob targets kb tools only.
  assert_no_tool_calls

  # The area-id from prepare reached the LLM through the system prompt's
  # area index, even with kb tools off.
  assert_llm_contains   "$AREA_ID"
  assert_step_status_is "completed"
}
