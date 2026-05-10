# scripts/spike/lib/scenario.sh
#
# Scenario lifecycle orchestration.
#
# Provides:
#   spike_run_scenario <exp_id> <scenario_name>
#
# Looks up the brain instance under SPIKE_INSTANCES_DIR/<exp_id>, reads
# its meta to learn the experiment name, locates the scenario script
# under SPIKE_REPO_ROOT/experiments/<experiment>/scenarios/<scenario>.sh,
# cuts a branch off e2e/source, sources the scenario, runs prepare /
# stimulate / observe in order, tags the branch end, and writes a result
# record under experiments/<experiment>/runs/<exp_id>/<scenario>.json.
#
# Returns 0 if every assertion in observe() passed, else 1. On failure
# the scenario branch is preserved so the operator can inspect with
# normal git tools.

# Resolve the directory containing the scenario library files. Sibling
# files (step.sh, assert.sh, meta.sh) are sourced from here.
_spike_scenario_lib_dir() {
  printf '%s' "${BASH_SOURCE[0]%/*}"
}

spike_run_scenario() {
  if [[ $# -ne 2 ]]; then
    echo "spike_run_scenario: usage: spike_run_scenario <exp_id> <scenario>" >&2
    return 2
  fi
  local exp_id="$1" scenario="$2"

  local instances_dir="${SPIKE_INSTANCES_DIR:-$HOME/.mykb-experiments}"
  local repo_root="${SPIKE_REPO_ROOT:-}"
  if [[ -z "$repo_root" ]]; then
    echo "spike_run_scenario: SPIKE_REPO_ROOT must be set (path of mykb checkout containing experiments/)" >&2
    return 1
  fi

  local instance="$instances_dir/$exp_id"
  if [[ ! -d "$instance" || ! -d "$instance/.git" ]]; then
    echo "spike_run_scenario: instance not found: $instance" >&2
    return 1
  fi

  # Pull experiment name out of meta so a single instance can be looked
  # up regardless of the experiment subdirectory naming.
  local lib
  lib="$(_spike_scenario_lib_dir)"
  # shellcheck source=meta.sh
  source "$lib/meta.sh"
  local experiment
  experiment="$(spike_read_meta "$instance" experiment)"
  if [[ -z "$experiment" ]]; then
    echo "spike_run_scenario: experiment field missing in meta for $exp_id" >&2
    return 1
  fi

  local scenario_file="$repo_root/experiments/$experiment/scenarios/$scenario.sh"
  if [[ ! -f "$scenario_file" ]]; then
    echo "spike_run_scenario: scenario file not found: $scenario_file" >&2
    return 1
  fi

  # Source helpers so the scenario sees intent/step/kb and assert_*.
  # shellcheck source=step.sh
  source "$lib/step.sh"
  # shellcheck source=assert.sh
  source "$lib/assert.sh"

  # Set the per-scenario context the helpers consume.
  export SPIKE_INSTANCE="$instance"
  export SPIKE_EXP_ID="$exp_id"
  export SPIKE_SCENARIO="$scenario"
  export SPIKE_STEP_NUM=0
  # Per-scenario stable session id. Threaded into vfa via step.sh as
  # KB_SESSION_ID so mykb's extension state (signals, loaded areas)
  # persists across the separate Pi containers a scenario's multiple
  # `step` calls spin up. Each scenario gets a unique id (so cross-
  # scenario state never leaks); within a scenario the id is stable
  # (so signals from step N feed step N+1). The session-state file at
  # <brainPath>/.sessions/<id>.json is wiped at scenario start so
  # retries don't see stale state from prior runs.
  export SPIKE_SCENARIO_SESSION_ID="spike-${exp_id}-${scenario}"
  rm -f "${instance}/.sessions/${SPIKE_SCENARIO_SESSION_ID}.json" 2>/dev/null || true
  unset SPIKE_LAST_STEP_FILE SPIKE_SCENARIO_INTENT
  spike_assert_reset

  # Cut a fresh scenario branch from e2e/source. If the same scenario was
  # run before, blow the old branch away — the regression suite re-runs
  # scenarios; we don't want history to bleed across runs.
  #
  # Use force-checkout because a prior crashed run may have left the
  # working tree dirty (incomplete step file, etc.). The scenario branch
  # is about to be deleted anyway; nothing to preserve.
  (
    cd "$instance"
    git checkout -qf "e2e/source" 2>/dev/null
    git branch -D "e2e/$scenario" >/dev/null 2>&1 || true
    git tag  -d  "e2e/$scenario-end" >/dev/null 2>&1 || true
    git checkout -q -b "e2e/$scenario" "e2e/source"
  )

  # Regenerate kb.db from the just-checked-out JSONL. kb.db is
  # gitignored, so a prior scenario's mutations stay in SQLite even
  # after switching branches — leaking state into the new scenario's
  # search/scoring operations. Rebuilding here makes SQLite consistent
  # with the JSONL files in the working tree.
  # shellcheck source=build-snapshot.sh
  source "$lib/build-snapshot.sh"
  spike_rebuild_instance "$instance" >/dev/null || {
    echo "spike_run_scenario: failed to rebuild instance SQLite" >&2
    return 1
  }

  # Default no-op implementations so a scenario can omit any phase.
  prepare()   { :; }
  stimulate() { :; }
  observe()   { :; }

  # shellcheck source=/dev/null
  source "$scenario_file"

  # Each phase runs even if a prior phase threw — we still want to write
  # a result file with whatever assertions did run. The phase's own exit
  # is captured into the result via SPIKE_PHASE_*_RC for diagnostics.
  local prep_rc=0 stim_rc=0 obs_rc=0
  prepare    || prep_rc=$?
  stimulate  || stim_rc=$?
  observe    || obs_rc=$?

  # End-of-scenario tag — operator can `git diff e2e/source..e2e/<s>-end`.
  ( cd "$instance" && git tag "e2e/$scenario-end" HEAD )

  # Persist a slim run record. runs/ is gitignored per methodology;
  # the durable artifact is the spec + the scenario script.
  local runs_dir="$repo_root/experiments/$experiment/runs/$exp_id"
  mkdir -p "$runs_dir"
  local result_file="$runs_dir/$scenario.json"
  local pass="true"
  [[ "${SPIKE_ASSERT_FAIL:-0}" -gt 0 ]] && pass="false"

  jq -n \
    --arg scenario "$scenario" \
    --arg exp_id   "$exp_id" \
    --arg experiment "$experiment" \
    --arg intent   "${SPIKE_SCENARIO_INTENT:-}" \
    --argjson pass $pass \
    --argjson total "${SPIKE_ASSERT_TOTAL:-0}" \
    --argjson p     "${SPIKE_ASSERT_PASS:-0}" \
    --argjson f     "${SPIKE_ASSERT_FAIL:-0}" \
    --arg failures "${SPIKE_ASSERT_FAILURES:-}" \
    --arg finished_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    '{
      scenario:    $scenario,
      exp_id:      $exp_id,
      experiment:  $experiment,
      intent:      $intent,
      pass:        $pass,
      assertions:  { total: $total, pass: $p, fail: $f },
      failures:    $failures,
      finished_at: $finished_at
    }' > "$result_file"

  [[ "$pass" == "true" ]]
}
