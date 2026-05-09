#!/usr/bin/env bats
#
# End-to-end smoke test for kb-spike.
#
# Uses a synthetic specimen + minimal experiment + stubbed vfa to exercise
# the full new -> run-scenario -> show -> diff -> discard lifecycle without
# touching ~/.mykb or running real Pi containers.
#
# This is the test the methodology calls "self-test for the harness."

setup() {
  TMP=$(mktemp -d)
  export SPIKE_REPO_ROOT="$TMP/repo"
  export SPIKE_SPECIMEN="$TMP/specimen"
  export SPIKE_INSTANCES_DIR="$TMP/instances"
  export VFA_HOME="$TMP/.vf-agents"
  mkdir -p "$VFA_HOME/profiles"

  # Build the synthetic specimen — a minimal git repo with one tracked file.
  mkdir -p "$SPIKE_SPECIMEN"
  (
    cd "$SPIKE_SPECIMEN"
    git init -q -b main
    git config user.email t@t
    git config user.name t
    echo "specimen-seed" > seed.txt
    git add -A
    git commit -q -m "init"
  )

  # Synthetic mykb checkout: scripts/spike/* (real, copied from the repo
  # under test) + dist/{bundle,cli}/ (stub artifacts) + experiments/smoke/.
  REAL_REPO="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  mkdir -p "$SPIKE_REPO_ROOT/scripts"
  cp -r "$REAL_REPO/scripts/spike" "$SPIKE_REPO_ROOT/scripts/spike"

  mkdir -p "$SPIKE_REPO_ROOT/dist/bundle" "$SPIKE_REPO_ROOT/dist/cli"
  echo "// fake bundle" > "$SPIKE_REPO_ROOT/dist/bundle/index.js"
  cat > "$SPIKE_REPO_ROOT/dist/cli/cli.js" <<'EOF'
const fs = require("fs");
const args = process.argv.slice(2);
const dir = process.env.MYKB_DIR || ".";
fs.writeFileSync(dir + "/cli-was-run.txt", args.join(" ") + "\n", { flag: "a" });
console.log("cli ran with " + args.join(" "));
EOF

  # Make the synthetic repo a git repo so capture_build can record a commit.
  (
    cd "$SPIKE_REPO_ROOT"
    git init -q -b main
    git config user.email t@t
    git config user.name t
    git add -A
    git commit -q -m "init synthetic mykb"
  )

  # Minimal experiment.
  mkdir -p "$SPIKE_REPO_ROOT/experiments/smoke/scenarios"
  cat > "$SPIKE_REPO_ROOT/experiments/smoke/EXPERIMENT.md" <<'MD'
# Experiment: smoke

## Intent
Exercise the kb-spike harness end-to-end using a stubbed Pi.

## Behavior matrix

| Stimulus      | Expected         | Scenario     |
|---------------|------------------|--------------|
| basic prompt  | echo response    | basic        |
MD

  cat > "$SPIKE_REPO_ROOT/experiments/smoke/scenarios/basic.sh" <<'SH'
intent "smoke: cli mutation + step echoes prompt"
prepare() {
  kb work create demo "Demo workspace"
}
stimulate() {
  step "probe" --prompt "hello smoke"
}
observe() {
  assert_llm_contains "hello smoke"
  assert_step_status_is "completed"
  assert_branch_diff_contains "cli-was-run.txt"
}
SH

  # Stub vfa.
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

  KB_SPIKE="$SPIKE_REPO_ROOT/scripts/spike/kb-spike"
}

teardown() {
  rm -rf "$TMP"
  unset SPIKE_REPO_ROOT SPIKE_SPECIMEN SPIKE_INSTANCES_DIR VFA_HOME
}

@test "kb-spike new creates a usable instance" {
  run "$KB_SPIKE" new --experiment smoke --intent "smoke run"
  [ "$status" -eq 0 ]
  exp_id="$(echo "$output" | tail -1)"
  [ -n "$exp_id" ]
  [ -d "$SPIKE_INSTANCES_DIR/$exp_id/.git" ]
  [ -f "$SPIKE_INSTANCES_DIR/$exp_id/.e2e-build/bundle/index.js" ]
  [ -f "$SPIKE_INSTANCES_DIR/$exp_id/.e2e-build/cli/cli.js" ]
  [ -f "$SPIKE_INSTANCES_DIR/$exp_id/.e2e-meta.json" ]
  [ -f "$VFA_HOME/profiles/e2e-$exp_id.yaml" ]
}

@test "full lifecycle: new -> run-scenario -> show -> diff -> discard" {
  exp_id="$("$KB_SPIKE" new --experiment smoke --intent "smoke" 2>/dev/null | tail -1)"
  [ -n "$exp_id" ]

  # run-scenario
  run "$KB_SPIKE" run-scenario "$exp_id" basic
  [ "$status" -eq 0 ]
  [ -f "$SPIKE_REPO_ROOT/experiments/smoke/runs/$exp_id/basic.json" ]
  [ "$(jq -r .pass "$SPIKE_REPO_ROOT/experiments/smoke/runs/$exp_id/basic.json")" = "true" ]

  # show
  run "$KB_SPIKE" show "$exp_id"
  [ "$status" -eq 0 ]
  [[ "$output" == *"experiment:"*"smoke"* ]]
  [[ "$output" == *"basic"*"pass=true"* ]]

  # diff (scoped to scenario end)
  run "$KB_SPIKE" diff "$exp_id" basic
  [ "$status" -eq 0 ]
  [[ "$output" == *"cli-was-run.txt"* ]]

  # list
  run "$KB_SPIKE" list
  [ "$status" -eq 0 ]
  [[ "$output" == *"$exp_id"* ]]

  # discard
  run "$KB_SPIKE" discard "$exp_id"
  [ "$status" -eq 0 ]
  [ ! -d "$SPIKE_INSTANCES_DIR/$exp_id" ]
  [ ! -f "$VFA_HOME/profiles/e2e-$exp_id.yaml" ]
}

@test "new refuses --experiment that has no EXPERIMENT.md" {
  run "$KB_SPIKE" new --experiment nonexistent
  [ "$status" -ne 0 ]
}

@test "new requires --experiment" {
  run "$KB_SPIKE" new
  [ "$status" -ne 0 ]
}

@test "unknown verb errors" {
  run "$KB_SPIKE" frobnicate
  [ "$status" -ne 0 ]
}
