# experiments/area-scoring/scenarios/token-budget-eviction.sh
#
# Covers the `token-budget-eviction` row of the area-scoring matrix:
# when the scored areas' entries together exceed the 2000-token injection
# budget, `selectEntriesForInjection` processes areas in score order and
# stops once the budget is spent — so the *highest-scoring* area's entries
# survive and a *lower-scoring* area's entries get evicted.
#
# Three synthetic areas, all matched by one pre-seeded nonce signal but at
# different strengths (the nonce string has 26 tokens; each area's summary
# contains a different prefix of them):
#   TOP    — summary has all 26 nonce tokens → score 26. Single tiny entry
#            = the WIDGET_MARKER fact (~21 tokens).
#   MIDDLE — summary has the first 18 nonce tokens → score 18. Single
#            entry = ~10 KB of marker-free filler — alone it overshoots
#            the 2000-token budget.
#   LOW    — summary has the first 11 nonce tokens → score 11. Single tiny
#            entry = the GADGET_MARKER fact (~21 tokens, payload "88.123").
#
# Budget arithmetic (DEFAULT_TOKEN_BUDGET = 2000; tokens ≈ chars/4):
#   GREEN: order TOP(26) → MIDDLE(18) → LOW(11) → specimens. TOP's tiny
#          fact injected (tokensUsed ≈ 21). MIDDLE's ~10 KB entry appended
#          (overshoots, but it's that area's first entry) → tokensUsed ≈
#          2641 → loop breaks before LOW (and before any specimen).
#          <mykb-context> carries the WIDGET_MARKER but NOT the GADGET
#          payload — LOW was evicted.
#   RED (DEFAULT_TOKEN_BUDGET → huge): nothing is ever evicted → LOW's
#          fact is injected too → the LLM can quote the GADGET payload →
#          `assert_llm_not_contains "88.123"` flips. (`assert_llm_contains
#          WIDGET_MARKER` still passes — TOP is injected either way; the
#          load-bearing assertion is the *absence* of the evicted area's
#          payload.)
#
# Isolation, same as scoring-isolated.sh / file-path-signal.sh / sticky-
# area-persistence.sh: SPIKE_DISABLE_TOOLS=1 (no kb_* tools), Pi runtime
# tools forbidden by the prompt and asserted absent, both markers live
# ONLY in entry text (never in a summary or in <mykb-areas>), and the
# nonce tokens are per-run-unique so they overlap only these three areas'
# summaries — far above the few generic-word matches the turn's prompt can
# give a specimen area, regardless of Pi's turn-1 input/context ordering
# (the earlier blocker, GH #6).

intent "When scored areas' entries exceed the 2000-token budget, the highest-scoring area's entries are kept and a lower-scoring area's entries are evicted"

# Disable kb_search/kb_load/kb_list. Pi runtime tools (bash, read, write,
# edit) are forbidden by the prompt and asserted absent below.
export SPIKE_DISABLE_TOOLS=1

E2E_RUN_UUID="${E2E_RUN_UUID:-$(date -u +%s%N)}"

# 26 per-run-unique nonce tokens (one per letter a..z). Lowercase-
# alphanumeric so each survives the scorer's tokenize() as a single
# distinct word. Different prefixes of this set go into the three areas'
# summaries; the whole set is the pre-seeded signal value.
NONCE_BASE="tbe${E2E_RUN_UUID:0:12}"
NONCE_ALL=""
for c in {a..z}; do NONCE_ALL+="${NONCE_BASE}${c} "; done
NONCE_ALL="${NONCE_ALL% }"
# Word-count prefixes: first 18 tokens for MIDDLE, first 11 for LOW.
NONCE_18="$(echo "$NONCE_ALL" | cut -d' ' -f1-18)"
NONCE_11="$(echo "$NONCE_ALL" | cut -d' ' -f1-11)"

WIDGET_MARKER="WIDGET_MARKER_${E2E_RUN_UUID}"
GADGET_MARKER="GADGET_MARKER_${E2E_RUN_UUID}"
GADGET_PAYLOAD="88.123"
AREA_TOP="e2e-tbe-top-${E2E_RUN_UUID:0:8}"
AREA_MIDDLE="e2e-tbe-middle-${E2E_RUN_UUID:0:8}"
AREA_LOW="e2e-tbe-low-${E2E_RUN_UUID:0:8}"

prepare() {
  # TOP: scores highest (all 26 nonce tokens in its summary). Tiny entry
  # = the WIDGET_MARKER fact; the marker is NOT in the summary.
  kb init area "$AREA_TOP" "Top" "$NONCE_ALL"
  kb add fact "$AREA_TOP" \
    "Marker ${WIDGET_MARKER}: blue widgets are calibrated at 12.7 hertz with a 3% tolerance band." \
    --tags widget,calibration

  # MIDDLE: scores second (first 18 nonce tokens). Single ~10 KB filler
  # entry, marker-free, big enough that it alone overshoots the budget —
  # so whatever ranks behind it is evicted.
  local filler
  filler="$(yes "Routine padding text for the middle-scoring area, nothing notable here, just bulk content to consume the injection token budget." | head -80 | tr '\n' ' ')"
  kb init area "$AREA_MIDDLE" "Middle" "$NONCE_18"
  kb add fact "$AREA_MIDDLE" "Filler ${E2E_RUN_UUID}: ${filler}" --tags routine

  # LOW: scores lowest (first 11 nonce tokens) — the area whose entry
  # should be evicted. Tiny entry = the GADGET_MARKER fact carrying the
  # distinctive ${GADGET_PAYLOAD} number; if the budget didn't evict it,
  # the LLM could quote that number.
  kb init area "$AREA_LOW" "Low" "$NONCE_11"
  kb add fact "$AREA_LOW" \
    "Marker ${GADGET_MARKER}: green gadgets run at ${GADGET_PAYLOAD} kilohertz with a 7% tolerance band." \
    --tags gadget,calibration

  # No workspace — a workspace block would list linked area-ids (FYSqWj10)
  # and an active workspace would re-set boostedAreas; we want boostedAreas
  # empty and loadedAreas empty so eviction is driven purely by the
  # scoreAreas scores. scenario.sh already cleared workspaces/.active.
  kb save

  # Pre-seed the persisted SessionState: one keyword signal carrying all
  # 26 nonce tokens; loadedAreas empty (no stickiness in this scenario).
  # File path / format mirror src/extension/state.ts. scenario.sh wipes
  # this file at scenario start, so recreating it here is retry-safe.
  mkdir -p "${SPIKE_INSTANCE}/.sessions"
  local now_ms; now_ms="$(date +%s%3N)"
  cat > "${SPIKE_INSTANCE}/.sessions/${SPIKE_SCENARIO_SESSION_ID}.json" <<EOF
{"signals":[{"type":"keyword","value":"${NONCE_ALL}","timestamp":${now_ms}}],"loadedAreas":[],"boostedAreas":[],"turnCount":4}
EOF
}

stimulate() {
  # Container starts -> session_start loads the pre-seeded signal -> first
  # `context` event: scoreAreas gives TOP 26, MIDDLE 18, LOW 11 (the nonce
  # tokens overlap only these three summaries among all areas) ->
  # selectEntriesForInjection processes TOP (tiny WIDGET fact injected) ->
  # MIDDLE (~10 KB entry appended, overshoots) -> tokensUsed >= 2000 ->
  # loop breaks -> LOW evicted -> <mykb-context> carries WIDGET_MARKER but
  # not the GADGET payload. With an unbounded budget LOW would be injected
  # too and the LLM could quote ${GADGET_PAYLOAD}.
  step "ask-both" --prompt "Your context may include up to two facts. (1) A fact whose text begins with 'WIDGET_MARKER' — if it is present, quote it verbatim on one line. (2) A fact whose text begins with 'GADGET_MARKER' — if it is present, quote it verbatim on one line. For any item that is NOT present in your context, reply for that item with exactly the single word ABSENT and do not write the marker name or guess its contents. Do not use any tools — no bash, no read, no write, no edit, no kb_* tools. Answer only from the context already provided to you."
}

observe() {
  # No tool calls of any kind — both markers must come (or not come)
  # through context injection, not a tool fallback.
  assert_no_tool_calls ""

  # TOP (highest score) kept its entry: the WIDGET_MARKER reached the LLM.
  assert_llm_contains    "$WIDGET_MARKER"
  assert_llm_contains_any "12.7" "hertz"

  # LOW (lowest score) was evicted by the token budget: its fact's
  # distinctive payload never reached the LLM, so the LLM couldn't quote
  # it. (Robust to the LLM paraphrasing "GADGET_MARKER is absent" — that
  # echoes the marker name, not the payload number.)
  assert_llm_not_contains "$GADGET_PAYLOAD"

  assert_step_status_is  "completed"
}
