#!/usr/bin/env bats
#
# Tests for scripts/spike/lib/step.sh
#
# Provides scenario-facing helpers:
#   intent "..."                — records scenario intent (one-line)
#   step <name> --prompt "..."  — invokes captured vfa, commits the step
#   kb <args>...                — invokes captured cli, commits any diff
#
# step writes the captured JSON to <instance>/.e2e-steps/<scenario>/<NNN>-<name>.json,
# updates SPIKE_LAST_STEP_FILE, and increments SPIKE_STEP_NUM. Each step
# is its own git commit on the current branch (whatever the orchestrator
# checked out).

setup() {
  TMP=$(mktemp -d)
  INSTANCE="$TMP/instance"
  STUB_DIR="$TMP/stubs"
  mkdir -p "$INSTANCE/.e2e-build/cli" "$STUB_DIR"

  # Initialize the instance as a git repo.
  (
    cd "$INSTANCE"
    git init -q -b main
    git config user.email "test@example.com"
    git config user.name "test"
    echo "init" > seed.txt
    git add seed.txt
    git commit -q -m "init"
  )

  # Stub vfa: echoes a JSON result and tags the prompt for inspection.
  cat > "$STUB_DIR/vfa" <<'EOF'
#!/usr/bin/env bash
prompt=""
profile=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --prompt) prompt="$2"; shift 2;;
    --profile) profile="$2"; shift 2;;
    *) shift;;
  esac
done
printf '{"result":"echo: %s","status":"completed","profile":"%s"}\n' "$prompt" "$profile"
EOF
  chmod +x "$STUB_DIR/vfa"

  # Stub captured cli: writes a marker file based on argv.
  cat > "$INSTANCE/.e2e-build/cli/cli.js" <<'EOF'
const args = process.argv.slice(2).join("_");
const fs = require("fs");
fs.writeFileSync(process.env.MYKB_DIR + "/cli-was-run.txt", args + "\n", { flag: "a" });
console.log("cli ran with " + args);
EOF

  # Commit captured build so the working tree is clean — mirrors the
  # orchestrator's "instance setup" commit after clone+capture.
  (
    cd "$INSTANCE"
    git add -A
    git commit -q -m "spike: instance setup"
  )

  PATH="$STUB_DIR:$PATH"
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  source "$REPO_ROOT/scripts/spike/lib/step.sh"

  # Required scenario-context env (orchestrator normally sets these).
  export SPIKE_INSTANCE="$INSTANCE"
  export SPIKE_EXP_ID="myexp-1"
  export SPIKE_SCENARIO="basic"
  export SPIKE_STEP_NUM=0
  unset SPIKE_LAST_STEP_FILE SPIKE_SCENARIO_INTENT
}

teardown() {
  rm -rf "$TMP"
  unset SPIKE_INSTANCE SPIKE_EXP_ID SPIKE_SCENARIO SPIKE_STEP_NUM \
        SPIKE_LAST_STEP_FILE SPIKE_SCENARIO_INTENT
}

@test "intent records SPIKE_SCENARIO_INTENT" {
  intent "probes resume continuity"
  [ "$SPIKE_SCENARIO_INTENT" = "probes resume continuity" ]
}

@test "step writes JSON to .e2e-steps/<scenario>/NNN-name.json" {
  step "first" --prompt "hello"
  [ -f "$INSTANCE/.e2e-steps/basic/001-first.json" ]
  grep -q "echo: hello" "$INSTANCE/.e2e-steps/basic/001-first.json"
}

@test "step exports SPIKE_LAST_STEP_FILE pointing at the file just written" {
  step "first" --prompt "x"
  [ -n "$SPIKE_LAST_STEP_FILE" ]
  [ -f "$SPIKE_LAST_STEP_FILE" ]
  [[ "$SPIKE_LAST_STEP_FILE" == */001-first.json ]]
}

@test "step increments SPIKE_STEP_NUM across calls" {
  step "a" --prompt "p1"
  [ "$SPIKE_STEP_NUM" -eq 1 ]
  step "b" --prompt "p2"
  [ "$SPIKE_STEP_NUM" -eq 2 ]
  [ -f "$INSTANCE/.e2e-steps/basic/002-b.json" ]
}

@test "step calls vfa with profile e2e-<exp_id> and the given prompt" {
  step "probe" --prompt "what is 2+2?"
  jf="$INSTANCE/.e2e-steps/basic/001-probe.json"
  [ "$(jq -r .profile "$jf")" = "e2e-myexp-1" ]
  [ "$(jq -r .result "$jf")" = "echo: what is 2+2?" ]
}

@test "step creates a git commit on the current branch" {
  before="$(cd "$INSTANCE" && git rev-parse HEAD)"
  step "x" --prompt "hi"
  after="$(cd "$INSTANCE" && git rev-parse HEAD)"
  [ "$before" != "$after" ]
  msg="$(cd "$INSTANCE" && git log -1 --pretty=%s)"
  [[ "$msg" == *"step("*"basic"*")"* ]]
  [[ "$msg" == *"x"* ]]
}

@test "step errors with usage when missing args" {
  run step
  [ "$status" -ne 0 ]
  run step "name-only"
  [ "$status" -ne 0 ]
}

@test "step errors when SPIKE_INSTANCE unset" {
  unset SPIKE_INSTANCE
  run step "x" --prompt "p"
  [ "$status" -ne 0 ]
}

@test "kb invokes captured cli with MYKB_DIR=instance" {
  kb work create alpha "Alpha workspace"
  marker="$INSTANCE/cli-was-run.txt"
  [ -f "$marker" ]
  grep -q "work_create_alpha_Alpha workspace" "$marker"
}

@test "kb commits any working-tree diff with kb-prefixed message" {
  before="$(cd "$INSTANCE" && git rev-parse HEAD)"
  kb work create beta "Beta"   # cli stub writes cli-was-run.txt
  after="$(cd "$INSTANCE" && git rev-parse HEAD)"
  [ "$before" != "$after" ]
  msg="$(cd "$INSTANCE" && git log -1 --pretty=%s)"
  [[ "$msg" == "kb work create beta Beta" ]]
}

@test "kb skips commit when working tree clean (cli was a no-op)" {
  # Replace the cli with a true no-op and commit so the tree starts clean.
  cat > "$INSTANCE/.e2e-build/cli/cli.js" <<'EOF'
process.exit(0);
EOF
  (cd "$INSTANCE" && git add -A && git commit -q -m "noop cli")
  before="$(cd "$INSTANCE" && git rev-parse HEAD)"
  kb status
  after="$(cd "$INSTANCE" && git rev-parse HEAD)"
  [ "$before" = "$after" ]
}

@test "kb propagates non-zero exit from captured cli" {
  cat > "$INSTANCE/.e2e-build/cli/cli.js" <<'EOF'
process.exit(7);
EOF
  run kb broken
  [ "$status" -eq 7 ]
}

@test "kb errors when captured cli is missing" {
  rm "$INSTANCE/.e2e-build/cli/cli.js"
  run kb anything
  [ "$status" -ne 0 ]
}
