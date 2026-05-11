# experiments/area-scoring/scenarios/file-path-signal.sh
#
# Covers the FilePathSignalProvider path of the area-scoring matrix:
# a `file_path` signal — the kind src/extension/hooks/signals.ts'
# createToolCallHandler emits when the LLM Reads/Writes/Edits a file —
# whose path tokens overlap an area's summary drives that area's score,
# and the area's entry reaches the LLM via per-turn context injection.
#
# Why this scenario only PRE-SEEDS the signal instead of having the LLM
# do a real Read in a first step:
#
#   The signal's *value* must be a file path containing a token unique
#   to this run's synthetic area (so only that area scores). For the LLM
#   to touch such a path it must either (a) be told the path in the
#   prompt — which puts the unique token into the turn's `input` event,
#   so a `keyword` signal would score the area even if createToolCallHandler
#   were completely broken (the test would pass with a broken handler) —
#   or (b) invent the path itself, which prepare() can't predict and so
#   can't bake into the area summary. Either way a real first step fails
#   to isolate the file-path path.
#
#   So, exactly like scoring-isolated.sh, we pre-seed the persisted
#   SessionState file — "the second turn of a long session whose first
#   turn already Read a project file" is plausible workflow lineage in
#   the methodology sense. That a real `read`/`write`/`edit` tool_call
#   produces exactly this `{type:'file_path', value:<path>}` signal is
#   covered at Layer 1 by tests/extension/signal-hooks.test.ts. This
#   scenario covers the other half end-to-end: the path-shaped signal
#   feeds scoring (FilePathSignalProvider.score splits on '/' and '.'),
#   wins entry selection within the 2000-token budget, and the marker
#   FACT lands in the LLM's context — with every tool fallback disabled.

intent "A pre-seeded file_path signal whose path tokens overlap an area's summary delivers that area's marker fact to the LLM via per-turn context injection, with all tool fallbacks disabled"

# Disable kb_search/kb_load/kb_list. Pi runtime tools (bash, read,
# write, edit) are forbidden by the prompt and asserted absent below.
export SPIKE_DISABLE_TOOLS=1

E2E_RUN_UUID="${E2E_RUN_UUID:-$(date -u +%s%N)}"
# Per-run unique token, lowercase-alphanumeric so it survives the
# scorer's tokenize() as a single word. It appears in BOTH the area
# summary AND the pre-seeded file path's directory component, and
# nowhere else — so among all specimen areas only this one scores from
# the signal. (scoring-isolated.sh verified that a unique nonce isolates
# scoring to one area; common English would dilute across 10+ areas and
# evict the marker under the token budget.)
NONCE="fpsig${E2E_RUN_UUID:0:12}"
WIDGET_MARKER="WIDGET_MARKER_${E2E_RUN_UUID}"
AREA_ID="e2e-widgets-${E2E_RUN_UUID:0:8}"
# Path lives under /tmp/, not the brain mount, so its non-nonce tokens
# ('tmp', 'spec', 'md') don't collide with real area summaries the way
# '.mykb'/'areas' would.
SEED_PATH="/tmp/${NONCE}/spec.md"

prepare() {
  # Area summary contains the unique nonce so the file path's nonce
  # component scores this area. The marker lives ONLY in the entry
  # text — not in summary, not in tags, not in <mykb-areas>; the only
  # path it can reach the LLM is per-turn context injection.
  kb init area "$AREA_ID" "Widgets" \
    "Calibration domain ${NONCE} for blue-unit hertz tolerances"
  kb add fact "$AREA_ID" \
    "Marker ${WIDGET_MARKER}: blue widgets are calibrated at 12.7 hertz with a 3% tolerance band." \
    --tags widget,calibration

  # No workspace — the workspace block would list linked area-ids and
  # let the LLM answer area-level questions without scoring (FYSqWj10).
  kb save

  # Pre-seed the persisted SessionState with a single file_path signal,
  # exactly the shape createToolCallHandler.addSignal('file_path', path)
  # writes. File path / format mirror src/extension/state.ts:
  #   <brainPath>/.sessions/<id>.json  with the SessionStateSnapshot type.
  # scenario.sh wipes this file at scenario start, so recreating it here
  # is safe across retries. With this signal pre-loaded, the FIRST
  # `context` call of the (single) step sees non-empty signals — the Pi
  # event-ordering gotcha (context fires before input on turn 1) would
  # otherwise make turn 1 inject nothing.
  mkdir -p "${SPIKE_INSTANCE}/.sessions"
  local now_ms; now_ms="$(date +%s%3N)"
  cat > "${SPIKE_INSTANCE}/.sessions/${SPIKE_SCENARIO_SESSION_ID}.json" <<EOF
{"signals":[{"type":"file_path","value":"${SEED_PATH}","timestamp":${now_ms}}],"loadedAreas":[],"boostedAreas":[],"turnCount":0}
EOF
}

stimulate() {
  # Single step. Container starts -> session_start loads the pre-seeded
  # file_path signal -> Pi's first `context` event fires with that
  # signal present -> scoreAreas runs both providers over it; the path
  # splits to ['tmp','${NONCE}','spec','md'], '${NONCE}' overlaps this
  # area's summary among all specimen areas -> selectEntriesForInjection
  # picks the marker fact within the 2000-token budget -> the
  # <mykb-context> block is injected -> the LLM cites the marker.
  step "ask-marker" --prompt "Your context includes a fact whose text begins with 'WIDGET_MARKER'. Quote that entire fact verbatim, on one line. Do not paraphrase. Do not use any tools — no bash, no read, no write, no edit, no kb_* tools. Answer only from the context already provided to you; if no such fact is present, say so."
}

observe() {
  # No tool calls of any kind — empty prefix matches every tool name.
  # If bash/read/write/edit or any kb_* tool fired, the LLM had a
  # fallback path to the fact and this scenario proves nothing.
  assert_no_tool_calls ""

  # The marker reached the LLM via the only remaining path: per-turn
  # context injection driven by the pre-seeded file_path signal.
  assert_llm_contains    "$WIDGET_MARKER"
  assert_llm_contains_any "12.7" "hertz"
  assert_step_status_is  "completed"
}
