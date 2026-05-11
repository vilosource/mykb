# experiments/area-scoring/scenarios/workspace-boost.sh
#
# Covers the WORKSPACE_BOOST row of the area-scoring matrix: an area
# linked to the active workspace gets scoreAreas's WORKSPACE_BOOST (+0.5)
# even when it has zero keyword overlap with the turn's signals — so its
# entries reach the LLM via per-turn context injection. An unlinked
# competitor that *does* match the signal scores higher on keywords;
# both end up injected (the budget is huge relative to two tiny facts),
# but the load-bearing point is that the linked area is scored *at all*.
#
# Isolation (FYSqWj10 discipline): the WIDGET_MARKER fact lives only in
# the linked area's entry text — not in its summary (so it can't reach
# the LLM via <mykb-areas>), not in the workspace metadata (the
# <mykb-workspace> block lists the linked area-id and the workspace
# state, never an area's facts), and kb_*/bash are forbidden + asserted
# absent. The only path the marker can reach the LLM is <mykb-context>
# driven by the workspace boost. RED-proof: remove the boost from
# scoreAreas and the linked area is never scored -> never injected ->
# marker absent. (See scoring-isolated.sh for why a pre-seeded signal
# is used: the Pi event-ordering gotcha — context fires before input on
# turn 1, so without a pre-seeded signal turn 1 injects nothing.)

intent "An area linked to the active workspace is scored via WORKSPACE_BOOST despite zero keyword overlap; its marker fact reaches the LLM via per-turn context injection"

# kb_search/kb_load/kb_list off; Pi runtime tools forbidden by the
# prompt and asserted absent below.
export SPIKE_DISABLE_TOOLS=1

E2E_RUN_UUID="${E2E_RUN_UUID:-$(date -u +%s%N)}"
# Per-run unique token, lowercase-alphanumeric so it survives tokenize()
# as a single word. It appears ONLY in the unlinked competitor's summary
# (and in the pre-seeded keyword signal) — so among all specimen areas
# only that competitor scores on keywords.
NONCE="wbsig${E2E_RUN_UUID:0:12}"
WIDGET_MARKER="WIDGET_MARKER_${E2E_RUN_UUID}"
AREA_BOOSTED="e2e-wb-boosted-${E2E_RUN_UUID:0:8}"
AREA_PLAIN="e2e-wb-plain-${E2E_RUN_UUID:0:8}"

prepare() {
  # Linked area: holds the marker FACT. Its summary deliberately does
  # NOT contain the nonce — so it gets zero keyword overlap with the
  # turn's signal, and the only thing that scores it is the workspace
  # boost.
  kb init area "$AREA_BOOSTED" "Boosted" \
    "Field-replaceable assemblies and torque specs for the rotor housing"
  kb add fact "$AREA_BOOSTED" \
    "Marker ${WIDGET_MARKER}: blue widgets are calibrated at 12.7 hertz with a 3% tolerance band." \
    --tags widget,calibration

  # Unlinked competitor: its summary contains the nonce, so the
  # pre-seeded keyword signal scores it (and only it, among all specimen
  # areas). It has a fact, but NOT the marker.
  kb init area "$AREA_PLAIN" "Plain" \
    "Calibration domain ${NONCE} for blue-unit hertz tolerances"
  kb add fact "$AREA_PLAIN" \
    "Routine plain fact about the ${NONCE} domain; nothing notable here." \
    --tags routine

  # Active workspace links ONLY the boosted area. before_agent_start
  # reads workspace.areas and calls state.setBoostedAreas([AREA_BOOSTED]).
  kb work create wb-demo "Workspace-boost demo" --areas "$AREA_BOOSTED"
  kb work start wb-demo
  kb work state --phase "implementation" --active "checking rotor-housing torque specs"
  kb save

  # Pre-seed the keyword signal so turn 1's first `context` call (which
  # fires before the `input` event) has a non-empty signal set. Same
  # mechanism as scoring-isolated.sh; file path/format mirror
  # src/extension/state.ts (<brainPath>/.sessions/<id>.json).
  mkdir -p "${SPIKE_INSTANCE}/.sessions"
  local now_ms; now_ms="$(date +%s%3N)"
  cat > "${SPIKE_INSTANCE}/.sessions/${SPIKE_SCENARIO_SESSION_ID}.json" <<EOF
{"signals":[{"type":"keyword","value":"${NONCE}","timestamp":${now_ms}}],"loadedAreas":[],"boostedAreas":[],"turnCount":0}
EOF
}

stimulate() {
  # Container starts -> before_agent_start sets boostedAreas=[AREA_BOOSTED]
  # -> first context event: scoreAreas sees the ${NONCE} keyword signal
  # (matches only AREA_PLAIN on keywords -> score 2) and applies
  # WORKSPACE_BOOST to AREA_BOOSTED (score 0.5) -> selectEntriesForInjection
  # processes both within the 2000-token budget -> <mykb-context> carries
  # both areas' facts -> the LLM sees the marker (in AREA_BOOSTED) and
  # cites it. Without the boost AREA_BOOSTED is never scored, so its
  # marker fact never reaches the LLM.
  step "ask-marker" --prompt "Your context includes a fact whose text begins with 'WIDGET_MARKER'. Quote that entire fact verbatim, on one line. Do not paraphrase. Do not use any tools — no bash, no read, no write, no edit, no kb_* tools. Answer only from the context already provided to you; if no such fact is present, say so."
}

observe() {
  # No tool calls of any kind — the marker must come through context
  # injection, not a tool fallback.
  assert_no_tool_calls ""

  assert_llm_contains    "$WIDGET_MARKER"
  assert_llm_contains_any "12.7" "hertz"
  assert_step_status_is  "completed"
}
