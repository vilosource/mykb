# experiments/kb-command/scenarios/load-marks-area-loaded.sh
#
# Covers (part of) the `/kb <area>` row of the kb-command matrix: the
# operator types `/kb <area>` in the Pi terminal; Pi dispatches the
# extension command; our handler (a) emits a `mykb-loaded-areas` custom
# message carrying that area's entries, and (b) marks the area loaded in
# SessionState (so the sticky-area boost picks it up on later turns).
#
# This is a SINGLE-step scenario by necessity: a `/kb` invocation does
# NOT trigger an LLM turn (it's a command, not a prompt), so there is no
# "the LLM cited the marker" assertion here — that needs a *second*
# prompt in the *same* Pi process, which the `step` helper can't deliver
# (one `pi -p "<prompt>"` per call, no Pi-level session continuity).
# The `load-and-cite` row of the matrix stays scaffolded on that harness
# gap (see EXPERIMENT.md). What this scenario *does* anchor:
#   - Pi recognises `/kb <area>` and invokes `command.handler` (the
#     `execute`-vs-`handler` bug would throw "command.handler is not a
#     function" here and nothing below would hold).
#   - the handler reaches `pi.sendMessage(...)` (the old `ctx.inject`
#     would throw "ctx.sendMessage is not a function" — surfaced as the
#     custom message NOT appearing in the run's event stream).
#   - the area's entries (the seeded marker) are in that message.
#   - `state.markAreaLoaded` persisted: `.sessions/<id>.json` lists the
#     area in `loadedAreas`.
#   - the command exits cleanly (status completed, no tool calls).
#
# Assertions on the emitted custom message read `vfa logs --raw <run_id>`
# (the JSON event stream — `message_start`/`message_end` events carry the
# `role:"custom"`, `customType` and `content`), the same source the
# tool-call assertions use.
#
# RED-proof: revert kb-command.ts to the broken shape — either
# `{ description, execute }` instead of `handler` (Pi throws
# "command.handler is not a function" → `.sessions/<id>.json` never
# created → assert_state_file_field "file missing"), or `ctx.inject(...)`
# instead of `pi.sendMessage(...)` (the `mykb-loaded-areas` message never
# appears in the event stream → those assertions flip; loadedAreas is
# still persisted because `markAreaLoaded` runs first, so the bug is
# pinpointed to injection vs. dispatch). (`npm run bundle:all`, kb-spike
# new, run; then `git checkout -- src/` + rebuild.)
#
# Note: we do NOT set SPIKE_DISABLE_TOOLS — MYKB_DISABLE_TOOLS=1 skips
# registerTools(), but the `/kb` command is registered separately
# (registerCommand), so it'd survive — still, no reason to set it.

intent "/kb <area> dispatches the command, emits a mykb-loaded-areas message with the area's entries, and marks the area loaded"

E2E_RUN_UUID="${E2E_RUN_UUID:-$(date -u +%s%N)}"
FACT_MARKER="KBCMD_MARKER_${E2E_RUN_UUID}"
AREA_ID="e2e-frobnicators-${E2E_RUN_UUID:0:8}"
WS_ID="e2e-kbcmd-${E2E_RUN_UUID:0:8}"

prepare() {
  # Plausible lineage: an active workspace where the operator wants to
  # force a particular area into context for the next turn.
  kb init area "$AREA_ID" "Frobnicators" \
    "Frobnicator calibration tolerances and field-replaceable assemblies"
  kb add fact "$AREA_ID" "${FACT_MARKER}: blue frobnicator units operate at 12.7 hertz with a 3% tolerance band"
  kb work create "$WS_ID" "Kb-command demo"
  kb work start "$WS_ID"
  kb work state --phase "implementation" --active "consulting frobnicator specs"
  kb save
}

stimulate() {
  step "load-area" --prompt "/kb ${AREA_ID}"
}

observe() {
  # The command-only invocation completed and ran no LLM tools.
  assert_step_status_is "completed"
  assert_no_tool_calls ""

  # The handler emitted the mykb-loaded-areas custom message carrying the
  # seeded marker. Inspect the run's raw event stream.
  local run_id logs
  run_id="$(jq -r '.run_id // empty' "$SPIKE_LAST_STEP_FILE")"
  logs="$(vfa logs --raw "$run_id" 2>/dev/null || true)"

  if grep -q '"customType":"mykb-loaded-areas"' <<<"$logs"; then _spike_assert_pass
  else _spike_assert_fail "/kb: no mykb-loaded-areas custom message in the run event stream"; fi

  if grep -qF "$FACT_MARKER" <<<"$logs"; then _spike_assert_pass
  else _spike_assert_fail "/kb: the seeded marker '$FACT_MARKER' is not in the run event stream (area entries not injected)"; fi

  if grep -qF "<mykb-loaded-areas>" <<<"$logs"; then _spike_assert_pass
  else _spike_assert_fail "/kb: the <mykb-loaded-areas> wrapper is not in the run event stream"; fi

  # markAreaLoaded persisted: SessionState lists the area.
  assert_state_file_field ".sessions/${SPIKE_SCENARIO_SESSION_ID}.json" \
    ".loadedAreas | index(\"${AREA_ID}\") != null" "true"
  assert_state_file_field ".sessions/${SPIKE_SCENARIO_SESSION_ID}.json" \
    ".loadedAreas | length" "1"
}
