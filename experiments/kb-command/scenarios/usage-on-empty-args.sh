# experiments/kb-command/scenarios/usage-on-empty-args.sh
#
# Covers the `usage-on-empty-args` row of the kb-command matrix: typing
# `/kb` with no arguments emits a usage message and loads nothing.
#
# The contract (kb-command.ts): `areaIds.length === 0` → send the usage
# string, return — `state.markAreaLoaded` is never called, so SessionState
# either has no `loadedAreas` or an empty one. (Single-step by the same
# reasoning as load-marks-area-loaded — `/kb` triggers no LLM turn.)
#
# RED-proof: in kb-command.ts, drop the `if (areaIds.length === 0)` guard
# — `args.trim().split(/\s+/).filter(...)` on "" yields `[]`, the loop
# does nothing, `parts` is empty, and `send("")` emits an empty
# mykb-loaded-areas message instead of the usage text → the usage
# assertion flips. (`npm run bundle:all`, kb-spike new, run; then `git
# checkout -- src/` + rebuild.)

intent "/kb with no arguments emits a usage message and loads no area"

E2E_RUN_UUID="${E2E_RUN_UUID:-$(date -u +%s%N)}"
WS_ID="e2e-kbcmdu-${E2E_RUN_UUID:0:8}"

prepare() {
  kb work create "$WS_ID" "Kb-command usage demo"
  kb work start "$WS_ID"
  kb work state --phase "implementation" --active "fumbling the /kb syntax"
  kb save
}

stimulate() {
  # No area args at all. Pi parses `/kb` as command "kb" with args "".
  step "kb-no-args" --prompt "/kb"
}

observe() {
  assert_step_status_is "completed"
  assert_no_tool_calls ""

  local run_id logs
  run_id="$(jq -r '.run_id // empty' "$SPIKE_LAST_STEP_FILE")"
  logs="$(vfa logs --raw "$run_id" 2>/dev/null || true)"

  # The usage message was emitted (as a mykb-loaded-areas custom message).
  if grep -q '"customType":"mykb-loaded-areas"' <<<"$logs"; then _spike_assert_pass
  else _spike_assert_fail "/kb: no custom message emitted at all on empty args"; fi
  if grep -qF "Usage: /kb" <<<"$logs"; then _spike_assert_pass
  else _spike_assert_fail "/kb: empty-args invocation did not emit the usage message"; fi

  # Nothing was loaded: no .sessions file, or one whose loadedAreas is empty.
  local sess="$SPIKE_INSTANCE/.sessions/${SPIKE_SCENARIO_SESSION_ID}.json"
  if [[ ! -f "$sess" ]]; then
    _spike_assert_pass
  else
    local n
    n="$(jq -r '.loadedAreas | length' "$sess" 2>/dev/null || echo 0)"
    if [[ "$n" -eq 0 ]]; then _spike_assert_pass
    else _spike_assert_fail "/kb: empty-args invocation marked $n area(s) loaded; expected 0"; fi
  fi
}
