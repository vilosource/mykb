# experiments/kb-command/scenarios/unknown-area-no-load.sh
#
# Covers the `unknown-area-error` row of the kb-command matrix: `/kb
# <unknown-id>` emits a "No entries found for: <id>" message, marks
# nothing loaded, and exits cleanly (no crash, no LLM turn).
#
# The contract (kb-command.ts): `store.loadArea(unknownId, ...)` returns
# `[]` → the id goes into `emptyAreas`, NOT into `allEntries`, and
# `state.markAreaLoaded` is not called for it → `parts` is just the
# "No entries found for: <id>" line, sent as a mykb-loaded-areas custom
# message; `loadedAreas` stays empty. (Single-step — `/kb` triggers no
# LLM turn.)
#
# The unknown id is a unique-per-run nonce that cannot collide with any
# specimen area.
#
# RED-proof: in kb-command.ts, move `state.markAreaLoaded(areaId)` out of
# the `else` so it runs for empty areas too — `loadedAreas` then contains
# the bogus id and the "marked 0 loaded" assertion flips (the "No entries
# found" message still appears, so the bug is pinpointed). (`npm run
# bundle:all`, kb-spike new, run; then `git checkout -- src/` + rebuild.)

intent "/kb <unknown-area> emits a 'No entries found' message, loads nothing, and exits cleanly"

E2E_RUN_UUID="${E2E_RUN_UUID:-$(date -u +%s%N)}"
# A nonce area id that does not exist anywhere.
UNKNOWN_AREA="e2e-nope-${E2E_RUN_UUID}"
WS_ID="e2e-kbcmdx-${E2E_RUN_UUID:0:8}"

prepare() {
  kb work create "$WS_ID" "Kb-command unknown-area demo"
  kb work start "$WS_ID"
  kb work state --phase "implementation" --active "mistyping an area id"
  kb save

  # Sanity: the area really must not exist in the instance.
  if [[ -d "$SPIKE_INSTANCE/areas/$UNKNOWN_AREA" ]]; then
    echo "prepare: BUG — area $UNKNOWN_AREA already exists in the instance" >&2
    return 1
  fi
}

stimulate() {
  step "load-unknown" --prompt "/kb ${UNKNOWN_AREA}"
}

observe() {
  assert_step_status_is "completed"
  assert_no_tool_calls ""

  local run_id logs
  run_id="$(jq -r '.run_id // empty' "$SPIKE_LAST_STEP_FILE")"
  logs="$(vfa logs --raw "$run_id" 2>/dev/null || true)"

  # The "no entries" message was emitted, naming the unknown id.
  if grep -q '"customType":"mykb-loaded-areas"' <<<"$logs"; then _spike_assert_pass
  else _spike_assert_fail "/kb: no custom message emitted for an unknown area"; fi
  if grep -qF "No entries found for: ${UNKNOWN_AREA}" <<<"$logs"; then _spike_assert_pass
  else _spike_assert_fail "/kb: unknown-area invocation did not emit the 'No entries found' message"; fi
  # And the area-dump wrapper is NOT there (nothing to dump).
  if grep -qF "<mykb-loaded-areas>" <<<"$logs"; then
    _spike_assert_fail "/kb: emitted a <mykb-loaded-areas> dump wrapper for an unknown area"
  else
    _spike_assert_pass
  fi

  # Nothing was loaded.
  local sess="$SPIKE_INSTANCE/.sessions/${SPIKE_SCENARIO_SESSION_ID}.json"
  if [[ ! -f "$sess" ]]; then
    _spike_assert_pass
  else
    local n
    n="$(jq -r '.loadedAreas | length' "$sess" 2>/dev/null || echo 0)"
    if [[ "$n" -eq 0 ]]; then _spike_assert_pass
    else _spike_assert_fail "/kb: unknown-area invocation marked $n area(s) loaded; expected 0"; fi
  fi

  # The area was NOT created on disk (loadArea must not be a side-effecting create).
  if [[ -d "$SPIKE_INSTANCE/areas/$UNKNOWN_AREA" ]]; then
    _spike_assert_fail "/kb: unknown area $UNKNOWN_AREA was created on disk"
  else
    _spike_assert_pass
  fi
}
