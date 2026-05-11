# experiments/area-scoring/scenarios/sticky-area-persistence.sh
#
# Covers the `sticky-area-persistence` row of the area-scoring matrix:
# an area that was loaded in a prior turn (it's in `loadedAreas`) gets
# `selectEntriesForInjection`'s STICKY_BOOST (+2) on the current turn, so
# under a tight token budget its entries survive even when an equally
# keyword-matched competitor would otherwise tie it and — by the
# deterministic area-id tie-break — push it out.
#
# Single-step + pre-seeded SessionState, exactly like scoring-isolated.sh
# and file-path-signal.sh:
#   - SPIKE_DISABLE_TOOLS=1 (no kb_* tools); Pi runtime tools forbidden
#     by the prompt + asserted absent. The WIDGET_MARKER lives ONLY in
#     AREA_STICKY's entry text — not in its summary, not in tags, not in
#     <mykb-areas> — so the only path it can reach the LLM is the per-turn
#     <mykb-context> injection.
#   - The pre-seeded signal value is a string of ~20 per-run-unique nonce
#     tokens, all present in BOTH AREA_STICKY's and AREA_FRESH's summaries
#     and in NO specimen area's summary. This makes STICKY/FRESH score ~20
#     each on the pre-seeded signal alone — far above the handful of
#     generic-word matches the turn's `input` event (the prompt) can give
#     a specimen area, regardless of whether `input` fires before or after
#     `context` on turn 1. (Root cause of the earlier blocker — GH #6: a
#     one-token nonce signal scored STICKY/FRESH at only 2, low enough
#     that prompt-word noise on specimen areas could out-rank STICKY and
#     fill the budget. A dominant nonce score removes that.)
#
# Budget arithmetic (DEFAULT_TOKEN_BUDGET = 2000; tokens ≈ chars/4):
#   GREEN: STICKY 20 + STICKY_BOOST 2 = 22 → ranked first → its tiny
#          marker fact (~21 tokens) injected → tokensUsed ≈ 21. FRESH 20
#          → next; FRESH's single ~10 KB filler entry is appended even
#          though it overshoots (the over-budget guard only trips when the
#          area already has an entry) → tokensUsed ≈ 2570 → loop breaks
#          before any specimen. <mykb-context> carries the WIDGET_MARKER.
#   RED (STICKY_BOOST → 0): STICKY 20 == FRESH 20 → tie → area-id
#          tie-break → "e2e-sap-fresh-…" sorts before "e2e-sap-sticky-…"
#          → FRESH first → its ~10 KB entry fills the budget → STICKY's
#          loop iteration breaks (`tokensUsed >= tokenBudget`) → STICKY
#          never injected → the marker is absent and the LLM reports it.

intent "An area in loadedAreas gets the STICKY_BOOST and survives a tight token budget against an equally-keyword-matched competitor; without the boost the competitor's bulk entry evicts it"

# Disable kb_search/kb_load/kb_list. Pi runtime tools (bash, read, write,
# edit) are forbidden by the prompt and asserted absent below.
export SPIKE_DISABLE_TOOLS=1

E2E_RUN_UUID="${E2E_RUN_UUID:-$(date -u +%s%N)}"

# ~20 per-run-unique nonce tokens. Lowercase-alphanumeric so each
# survives the scorer's tokenize() as a single distinct word. They go
# verbatim into both synthetic areas' summaries AND the pre-seeded
# signal value — so STICKY and FRESH each score ~20 from the pre-seeded
# signal, dominating any generic-word overlap a specimen area picks up
# from the prompt.
NONCE_BASE="sap${E2E_RUN_UUID:0:12}"
NONCE_WORDS=""
for c in {a..t}; do NONCE_WORDS+="${NONCE_BASE}${c} "; done
NONCE_WORDS="${NONCE_WORDS% }"

WIDGET_MARKER="WIDGET_MARKER_${E2E_RUN_UUID}"
# Names chosen so AREA_FRESH sorts before AREA_STICKY (the RED tie-break
# must hand the budget to FRESH): "e2e-sap-fresh-…" < "e2e-sap-sticky-…".
AREA_STICKY="e2e-sap-sticky-${E2E_RUN_UUID:0:8}"
AREA_FRESH="e2e-sap-fresh-${E2E_RUN_UUID:0:8}"

prepare() {
  # STICKY: summary = the nonce tokens (so it scores ~20 on the pre-seed
  # signal). Single entry = the marker fact; the marker is NOT in the
  # summary, so it can only reach the LLM via <mykb-context>. No tags —
  # STICKY and FRESH must score *identically* on scoreAreas so that with
  # STICKY_BOOST removed they truly tie (and the area-id tie-break, not a
  # stray score difference, decides). In particular: a "widget" tag here
  # would overlap the prompt's word "widget" (from "WIDGET_MARKER"),
  # silently giving STICKY +1 over FRESH and masking the boost.
  kb init area "$AREA_STICKY" "Sticky" "$NONCE_WORDS"
  kb add fact "$AREA_STICKY" \
    "Marker ${WIDGET_MARKER}: blue widgets are calibrated at 12.7 hertz with a 3% tolerance band."

  # FRESH: same nonce summary, no tags (scores identically to STICKY on
  # scoreAreas — the equally-matched competitor). Single entry = ~10 KB
  # of marker-free filler, big enough that it alone overshoots the
  # 2000-token budget.
  # ~80 lines × ~130 chars ≈ 10 KB ≈ 2600 tokens — alone it overshoots
  # the 2000-token budget, so in the RED case (no STICKY_BOOST) it leaves
  # no room for STICKY's fact behind it.
  local filler
  filler="$(yes "Routine padding text for the fresh competitor area, nothing notable here, just bulk content to consume the injection token budget." | head -80 | tr '\n' ' ')"
  kb init area "$AREA_FRESH" "Fresh" "$NONCE_WORDS"
  kb add fact "$AREA_FRESH" "Filler ${E2E_RUN_UUID}: ${filler}"

  # No workspace — a workspace block would list linked area-ids and let
  # the LLM answer area-level questions without scoring (FYSqWj10), and
  # an active workspace would re-set boostedAreas (we want boostedAreas
  # empty so WORKSPACE_BOOST is out of the picture). scenario.sh already
  # cleared workspaces/.active.
  kb save

  # Pre-seed the persisted SessionState: one keyword signal carrying the
  # nonce tokens, and loadedAreas pre-loaded with AREA_STICKY — i.e.
  # "the Nth turn of a long session whose earlier turn loaded the sticky
  # area". File path / format mirror src/extension/state.ts
  # (<brainPath>/.sessions/<id>.json, the SessionStateSnapshot type).
  # scenario.sh wipes this file at scenario start, so recreating it here
  # is retry-safe.
  mkdir -p "${SPIKE_INSTANCE}/.sessions"
  local now_ms; now_ms="$(date +%s%3N)"
  cat > "${SPIKE_INSTANCE}/.sessions/${SPIKE_SCENARIO_SESSION_ID}.json" <<EOF
{"signals":[{"type":"keyword","value":"${NONCE_WORDS}","timestamp":${now_ms}}],"loadedAreas":["${AREA_STICKY}"],"boostedAreas":[],"turnCount":3}
EOF
}

stimulate() {
  # Container starts -> session_start loads the pre-seeded signal +
  # loadedAreas -> first `context` event: scoreAreas gives STICKY 20 and
  # FRESH 20 (the nonce tokens overlap only their summaries among all
  # areas) -> selectEntriesForInjection adds STICKY_BOOST to STICKY (in
  # loadedAreas) -> STICKY 22, FRESH 20 -> STICKY's tiny marker fact is
  # injected, FRESH's bulk entry is appended (overshoots, but it's the
  # area's first entry), loop breaks -> <mykb-context> carries the
  # WIDGET_MARKER -> the LLM cites it. Remove STICKY_BOOST and STICKY
  # ties FRESH, FRESH's id sorts first, FRESH's bulk entry fills the
  # budget, STICKY is evicted, the marker never reaches the LLM.
  step "ask-marker" --prompt "Your context includes a fact whose text begins with 'WIDGET_MARKER'. Quote that entire fact verbatim, on one line. Do not paraphrase. Do not use any tools — no bash, no read, no write, no edit, no kb_* tools. Answer only from the context already provided to you; if no such fact is present, say so."
}

observe() {
  # No tool calls of any kind — the marker must come through context
  # injection, not a tool fallback. Empty prefix matches every tool name.
  assert_no_tool_calls ""

  # The sticky area's marker reached the LLM: STICKY_BOOST kept its tiny
  # fact ranked above FRESH's budget-filling bulk entry.
  assert_llm_contains    "$WIDGET_MARKER"
  assert_llm_contains_any "12.7" "hertz"
  assert_step_status_is  "completed"
}
