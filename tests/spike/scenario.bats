#!/usr/bin/env bats
#
# Tests for scripts/spike/lib/scenario.sh
#
# spike_run_scenario <exp_id> <scenario_name>
#   1. Locate instance ($SPIKE_INSTANCES_DIR/<exp_id>) and read meta.
#   2. Locate scenario script in $SPIKE_REPO_ROOT/experiments/<exp>/scenarios/.
#   3. Cut e2e/<scenario> off e2e/source in the instance.
#   4. Source scenario, run prepare/stimulate/observe in order.
#   5. Tag e2e/<scenario>-end.
#   6. Write result.json under $SPIKE_REPO_ROOT/experiments/<exp>/runs/<exp_id>/<scenario>.json
#   7. Return 0 if SPIKE_ASSERT_FAIL == 0, else 1.

setup() {
  TMP=$(mktemp -d)
  export SPIKE_INSTANCES_DIR="$TMP/instances"
  export SPIKE_REPO_ROOT="$TMP/repo"

  EXP_ID="myfeat-20260509-1200"
  EXPERIMENT="myfeat"
  INSTANCE="$SPIKE_INSTANCES_DIR/$EXP_ID"

  # Build a minimal instance: git repo with e2e/source tag and a captured cli.
  mkdir -p "$INSTANCE/.e2e-build/cli"
  cat > "$INSTANCE/.e2e-build/cli/cli.js" <<'EOF'
const fs = require("fs");
fs.writeFileSync(process.env.MYKB_DIR + "/cli-was-run.txt", process.argv.slice(2).join(" ") + "\n", { flag: "a" });
console.log("ok");
EOF
  (
    cd "$INSTANCE"
    git init -q -b main
    git config user.email t@t
    git config user.name t
    echo "seed" > seed.txt
    git add -A
    git commit -q -m "init"
    git tag e2e/source HEAD
  )
  cat > "$INSTANCE/.e2e-meta.json" <<JSON
{"exp_id":"$EXP_ID","experiment":"$EXPERIMENT","intent":"test","specimen":"$HOME/.mykb","source_commit":"deadbeef","profile_path":"$TMP/.vf-agents/profiles/e2e-$EXP_ID.yaml","created_at":"2026-05-09T00:00:00Z"}
JSON

  # Stub vfa for step() calls.
  STUB_DIR="$TMP/stubs"
  mkdir -p "$STUB_DIR"
  cat > "$STUB_DIR/vfa" <<'EOF'
#!/usr/bin/env bash
prompt=""
while [[ $# -gt 0 ]]; do
  case "$1" in --prompt) prompt="$2"; shift 2;; *) shift;; esac
done
printf '{"result":"echo: %s","status":"completed"}\n' "$prompt"
EOF
  chmod +x "$STUB_DIR/vfa"
  PATH="$STUB_DIR:$PATH"

  # Build scenarios.
  mkdir -p "$SPIKE_REPO_ROOT/experiments/$EXPERIMENT/scenarios"
  cat > "$SPIKE_REPO_ROOT/experiments/$EXPERIMENT/scenarios/passing.sh" <<'SH'
intent "passing scenario"
prepare() {
  kb work create demo "demo"
}
stimulate() {
  step "probe" --prompt "say hello"
}
observe() {
  assert_llm_contains "hello"
  assert_step_status_is "completed"
  assert_branch_diff_contains "cli-was-run.txt"
}
SH

  cat > "$SPIKE_REPO_ROOT/experiments/$EXPERIMENT/scenarios/failing.sh" <<'SH'
intent "failing scenario"
prepare() { :; }
stimulate() { step "probe" --prompt "anything"; }
observe() { assert_llm_contains "ABSENT_MARKER"; }
SH

  REPO_FOR_LIBS="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  source "$REPO_FOR_LIBS/scripts/spike/lib/scenario.sh"
}

teardown() {
  rm -rf "$TMP"
  unset SPIKE_INSTANCES_DIR SPIKE_REPO_ROOT \
        SPIKE_INSTANCE SPIKE_EXP_ID SPIKE_SCENARIO SPIKE_STEP_NUM \
        SPIKE_LAST_STEP_FILE SPIKE_SCENARIO_INTENT \
        SPIKE_ASSERT_TOTAL SPIKE_ASSERT_PASS SPIKE_ASSERT_FAIL SPIKE_ASSERT_FAILURES
}

@test "spike_run_scenario succeeds for passing scenario" {
  run spike_run_scenario "$EXP_ID" "passing"
  [ "$status" -eq 0 ]
}

@test "passing scenario cuts e2e/<scenario> branch and tags end" {
  spike_run_scenario "$EXP_ID" "passing"
  cd "$INSTANCE"
  run git rev-parse --verify "refs/heads/e2e/passing"
  [ "$status" -eq 0 ]
  run git rev-parse --verify "refs/tags/e2e/passing-end"
  [ "$status" -eq 0 ]
}

@test "passing scenario writes result.json with pass=true and counts" {
  spike_run_scenario "$EXP_ID" "passing"
  result="$SPIKE_REPO_ROOT/experiments/$EXPERIMENT/runs/$EXP_ID/passing.json"
  [ -f "$result" ]
  [ "$(jq -r .pass "$result")" = "true" ]
  [ "$(jq -r .scenario "$result")" = "passing" ]
  [ "$(jq -r .exp_id "$result")" = "$EXP_ID" ]
  [ "$(jq -r .intent "$result")" = "passing scenario" ]
  [ "$(jq -r '.assertions.total' "$result")" -eq 3 ]
  [ "$(jq -r '.assertions.fail' "$result")" -eq 0 ]
}

@test "failing scenario returns non-zero and result.pass=false" {
  run spike_run_scenario "$EXP_ID" "failing"
  [ "$status" -ne 0 ]
  result="$SPIKE_REPO_ROOT/experiments/$EXPERIMENT/runs/$EXP_ID/failing.json"
  [ -f "$result" ]
  [ "$(jq -r .pass "$result")" = "false" ]
  [ "$(jq -r '.assertions.fail' "$result")" -ge 1 ]
  [[ "$(jq -r '.failures' "$result")" == *"ABSENT_MARKER"* ]]
}

@test "failing scenario preserves the branch (not auto-discarded)" {
  spike_run_scenario "$EXP_ID" "failing" || true
  cd "$INSTANCE"
  run git rev-parse --verify "refs/heads/e2e/failing"
  [ "$status" -eq 0 ]
}

@test "spike_run_scenario errors when scenario file missing" {
  run spike_run_scenario "$EXP_ID" "nonexistent"
  [ "$status" -ne 0 ]
  [[ "$output" == *"nonexistent"* ]] || [[ "$output" == *"not found"* ]]
}

@test "spike_run_scenario errors when instance missing" {
  run spike_run_scenario "no-such-exp" "passing"
  [ "$status" -ne 0 ]
}

@test "scenario can re-run: re-running same scenario replaces branch + result" {
  spike_run_scenario "$EXP_ID" "passing"
  spike_run_scenario "$EXP_ID" "passing"
  result="$SPIKE_REPO_ROOT/experiments/$EXPERIMENT/runs/$EXP_ID/passing.json"
  [ "$(jq -r .pass "$result")" = "true" ]
}

@test "spike_run_scenario errors with usage when missing args" {
  run spike_run_scenario
  [ "$status" -ne 0 ]
  run spike_run_scenario "$EXP_ID"
  [ "$status" -ne 0 ]
}
