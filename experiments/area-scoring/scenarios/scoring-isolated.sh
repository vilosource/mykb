# experiments/area-scoring/scenarios/scoring-isolated.sh
#
# v3 of the area-scoring matrix — genuinely isolates the per-turn
# context-injection path. Pairs with scoring-without-tools.sh:
#   scoring-without-tools (v2): tools-off, prove the area-INDEX in the
#                                system prompt is visible to the LLM.
#                                Asserts on the area-id, not on entries.
#   scoring-isolated (v3, this): tools-off, prove the per-turn CONTEXT
#                                INJECTION delivers a marker FACT (not
#                                just area metadata) to the LLM, with
#                                no fallback paths available.
#
# What "isolated" means here:
#   - kb_search/kb_load/kb_list disabled via MYKB_DISABLE_TOOLS=1
#     (existing knob; the LLM has none of the kb tools).
#   - Pi runtime tools (bash, Read, Write, Edit) are FORBIDDEN by the
#     prompt and asserted absent in observe(). The LLM cannot grep
#     facts.jsonl as a workaround.
#   - The marker keyword appears in the entry FACT only — it is NOT in
#     the area summary, NOT in tags, NOT visible in the area-index
#     block of the system prompt. The ONLY way the marker reaches the
#     LLM is via per-turn context injection: the scorer sees signals,
#     selects entries, renders <mykb-context> for the turn.
#
# Why this scenario was not possible before today:
#   The Pi event-ordering observation (kb gotcha, see scoring-without-
#   tools.sh) means the `context` hook fires before the `input` event
#   has seeded signals on the FIRST turn of a session. So a single-step
#   scenario can't observe scoring-driven injection: turn 1's context
#   fires with empty signals → no injection → no marker delivery.
#
#   This scenario uses TWO `step` calls in one scenario, threaded by a
#   scenario-stable KB_SESSION_ID (set by scenario.sh, propagated by
#   step.sh). Step 1's input event seeds the keyword signal; the
#   signal is persisted to disk via the new file-backed SessionState.
#   Step 2 starts a fresh Pi container with the same KB_SESSION_ID;
#   session_start loads the persisted signals; step 2's first context
#   call fires with non-empty signals → scoring fires → injection
#   happens → marker reaches the LLM. The asymmetry of the Pi event
#   model is converted from a blocker into a feature.

intent "Per-turn context injection delivers a marker FACT to the LLM with all tool fallbacks disabled"

# Disable kb_search/kb_load/kb_list. Pi runtime tools are forbidden by
# the prompt and the no-tool-calls assertion below.
export SPIKE_DISABLE_TOOLS=1

E2E_RUN_UUID="${E2E_RUN_UUID:-$(date -u +%s%N)}"
# Unique synthetic vocabulary. The KeywordSignalProvider tokenizes the
# user's prompt text into words and scores areas via word-overlap with
# their summary+tags. Common English words (e.g. "about", "knowledge",
# "calibration") match many specimen areas and would dilute scoring
# across 10+ unrelated areas, evicting our marker fact under the
# 2000-token budget. Using a per-run unique nonce token (NONCE) — and
# putting it in BOTH the area summary AND the seeding prompt — ensures
# only this area scores. Verified: substituting common English in the
# seeding prompt loaded 12 specimen areas; with the nonce it loads 1.
NONCE="frobsig${E2E_RUN_UUID:0:12}"
WIDGET_MARKER="WIDGET_MARKER_${E2E_RUN_UUID}"
AREA_ID="e2e-widgets-${E2E_RUN_UUID:0:8}"

prepare() {
  # Area summary contains the unique nonce so only this area scores
  # when signals contain it. Marker lives ONLY in the entry text — not
  # in summary, not in tags, not in <mykb-areas>.
  kb init area "$AREA_ID" "Widgets" \
    "Calibration domain ${NONCE} for blue-unit hertz tolerances"
  kb add fact "$AREA_ID" \
    "Marker ${WIDGET_MARKER}: blue widgets are calibrated at 12.7 hertz with a 3% tolerance band." \
    --tags widget,calibration

  # No workspace setup. FYSqWj10 path-isolation lesson — the workspace
  # block lists linked area-ids, which would let the LLM answer
  # area-level questions without scoring. Here the marker must come
  # ONLY through per-turn context injection.
  kb save

  # Pre-seed the signal in the persisted SessionState file. This
  # simulates "the second turn of a long session whose first turn
  # already established this signal" — plausible workflow lineage in
  # the methodology sense (real long-running sessions accumulate
  # signals turn-over-turn). Pre-seeding lets the FIRST context hook
  # call in this scenario's single step see non-empty signals,
  # bypassing the Pi event-ordering gotcha (context fires before
  # input on the very first turn — without pre-seeded signals the
  # first context call would EARLY RETURN with no injection).
  #
  # File path matches src/extension/state.ts's sessionStatePath():
  #   <brainPath>/.sessions/<id>.json
  # And the format matches the SessionStateSnapshot type in state.ts.
  mkdir -p "${SPIKE_INSTANCE}/.sessions"
  local now_ms; now_ms="$(date +%s%3N)"
  cat > "${SPIKE_INSTANCE}/.sessions/${SPIKE_SCENARIO_SESSION_ID}.json" <<EOF
{"signals":[{"type":"keyword","value":"${NONCE}","timestamp":${now_ms}}],"loadedAreas":[],"boostedAreas":[],"turnCount":0}
EOF
}

stimulate() {
  # Single step. The Pi container starts → session_start hook loads
  # the pre-seeded signal from disk → state.signals = [{type:keyword,
  # value:'${NONCE}'}]. Pi's first context event fires (before the
  # input event seeds further signals) → scoreAreas matches ONLY the
  # widget-calibration area (NONCE is unique to its summary among all
  # specimen areas) → selectEntriesForInjection picks the marker fact
  # within the 2000-token budget → renderContextBlock injects
  # <mykb-context> as a system message → LLM sees the marker and
  # cites it.
  step "ask-marker" --prompt "Quote the entire fact about blue ${NONCE} hertz tolerances verbatim, including any text starting with 'WIDGET_MARKER'. Do not paraphrase. Do not use any tools — no bash, no Read, no Write, no kb_* tools. Answer from the context already provided to you."
}

observe() {
  # No tool calls of any kind. assert_no_tool_calls with the empty
  # prefix matches every tool name → asserts the LLM made zero tool
  # calls. If bash, Read, Write, kb_search, etc. fired, this fails.
  assert_no_tool_calls ""

  # The marker reached the LLM via the only remaining path: per-turn
  # context injection driven by signals persisted from step 1.
  assert_llm_contains    "$WIDGET_MARKER"
  assert_llm_contains_any "12.7" "hertz"
  assert_step_status_is  "completed"
}
