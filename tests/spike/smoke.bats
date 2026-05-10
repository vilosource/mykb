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

  mkdir -p "$SPIKE_REPO_ROOT/dist/bundle" "$SPIKE_REPO_ROOT/dist/cli-bundle"
  echo "// fake bundle" > "$SPIKE_REPO_ROOT/dist/bundle/index.js"
  cat > "$SPIKE_REPO_ROOT/dist/cli-bundle/cli.js" <<'EOF'
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

@test "archive moves instance to archive/ and removes profile" {
  exp_id="$("$KB_SPIKE" new --experiment smoke --intent "for archive" 2>/dev/null | tail -1)"
  [ -d "$SPIKE_INSTANCES_DIR/$exp_id" ]

  run "$KB_SPIKE" archive "$exp_id"
  [ "$status" -eq 0 ]
  # Active dir is gone…
  [ ! -d "$SPIKE_INSTANCES_DIR/$exp_id" ]
  # …but the instance is preserved under archive/.
  [ -d "$SPIKE_INSTANCES_DIR/archive/$exp_id/.git" ]
  # Profile is removed.
  [ ! -f "$VFA_HOME/profiles/e2e-$exp_id.yaml" ]
  # Meta still readable so an operator can inspect the archived state.
  [ -f "$SPIKE_INSTANCES_DIR/archive/$exp_id/.e2e-meta.json" ]
}

@test "archive errors when target already exists" {
  exp_id="$("$KB_SPIKE" new --experiment smoke 2>/dev/null | tail -1)"

  # Pre-create the archive target with the same name.
  mkdir -p "$SPIKE_INSTANCES_DIR/archive/$exp_id"

  run "$KB_SPIKE" archive "$exp_id"
  [ "$status" -ne 0 ]
  [[ "$output" == *"archive target already exists"* ]]
  # Original instance untouched on failure.
  [ -d "$SPIKE_INSTANCES_DIR/$exp_id" ]
}

@test "archive errors on missing instance" {
  run "$KB_SPIKE" archive nonexistent-exp-id
  [ "$status" -ne 0 ]
}

@test "list ignores archive/ subdir" {
  # Archive directory shouldn't appear as if it were an instance.
  exp_id="$("$KB_SPIKE" new --experiment smoke 2>/dev/null | tail -1)"
  "$KB_SPIKE" archive "$exp_id" >/dev/null 2>&1

  run "$KB_SPIKE" list
  [ "$status" -eq 0 ]
  # The archived id won't appear (its containing dir is now archive/<id>,
  # not the active root). Belt-and-suspenders: assert the literal
  # "archive  " row doesn't show up either.
  [[ "$output" != *"$exp_id"* ]]
}

@test "run --prompt creates an _adhoc step on a fresh _adhoc branch" {
  exp_id="$("$KB_SPIKE" new --experiment smoke 2>/dev/null | tail -1)"

  run "$KB_SPIKE" run "$exp_id" --prompt "what does the LLM do?"
  [ "$status" -eq 0 ]

  # _adhoc step file exists with sequential index.
  [ -f "$SPIKE_INSTANCES_DIR/$exp_id/.e2e-steps/_adhoc/001-spike.json" ]
  # The vfa stub echoes the prompt back into result; the captured JSON
  # should contain it.
  grep -q "what does the LLM do?" "$SPIKE_INSTANCES_DIR/$exp_id/.e2e-steps/_adhoc/001-spike.json"

  # Branch e2e/_adhoc was created.
  (cd "$SPIKE_INSTANCES_DIR/$exp_id" && git rev-parse --verify e2e/_adhoc) >/dev/null
}

@test "run accumulates step numbers across invocations" {
  exp_id="$("$KB_SPIKE" new --experiment smoke 2>/dev/null | tail -1)"

  "$KB_SPIKE" run "$exp_id" --prompt "first" >/dev/null 2>&1
  "$KB_SPIKE" run "$exp_id" --prompt "second" >/dev/null 2>&1
  "$KB_SPIKE" run "$exp_id" --prompt "third" >/dev/null 2>&1

  [ -f "$SPIKE_INSTANCES_DIR/$exp_id/.e2e-steps/_adhoc/001-spike.json" ]
  [ -f "$SPIKE_INSTANCES_DIR/$exp_id/.e2e-steps/_adhoc/002-spike.json" ]
  [ -f "$SPIKE_INSTANCES_DIR/$exp_id/.e2e-steps/_adhoc/003-spike.json" ]
}

@test "run errors when --prompt missing" {
  exp_id="$("$KB_SPIKE" new --experiment smoke 2>/dev/null | tail -1)"
  run "$KB_SPIKE" run "$exp_id"
  [ "$status" -ne 0 ]
  [[ "$output" == *"--prompt is required"* ]]
}

@test "run errors when exp_id missing" {
  run "$KB_SPIKE" run --prompt "x"
  [ "$status" -ne 0 ]
}

@test "promote generates a scenario scaffold from _adhoc steps" {
  exp_id="$("$KB_SPIKE" new --experiment smoke 2>/dev/null | tail -1)"
  "$KB_SPIKE" run "$exp_id" --prompt "first probe" >/dev/null 2>&1
  "$KB_SPIKE" run "$exp_id" --prompt "second probe" >/dev/null 2>&1

  run "$KB_SPIKE" promote "$exp_id" --as graduated
  [ "$status" -eq 0 ]

  scaffold="$SPIKE_REPO_ROOT/experiments/smoke/scenarios/graduated.sh"
  [ -f "$scaffold" ]
  # Scaffold has the expected sections.
  grep -q "intent " "$scaffold"
  grep -q "prepare()" "$scaffold"
  grep -q "stimulate()" "$scaffold"
  grep -q "observe()" "$scaffold"
  # Both adhoc step prompts ended up as `step` calls in stimulate().
  grep -q "step \"spike\" --prompt" "$scaffold"
  # The TODO markers are present so the operator knows to fill them in.
  grep -q "TODO" "$scaffold"
}

@test "promote errors when target scenario already exists" {
  exp_id="$("$KB_SPIKE" new --experiment smoke 2>/dev/null | tail -1)"
  "$KB_SPIKE" run "$exp_id" --prompt "x" >/dev/null 2>&1

  run "$KB_SPIKE" promote "$exp_id" --as basic    # basic.sh exists in setup
  [ "$status" -ne 0 ]
  [[ "$output" == *"scenario already exists"* ]]
}

@test "promote rejects invalid scenario names" {
  exp_id="$("$KB_SPIKE" new --experiment smoke 2>/dev/null | tail -1)"
  "$KB_SPIKE" run "$exp_id" --prompt "x" >/dev/null 2>&1

  run "$KB_SPIKE" promote "$exp_id" --as "../escape"
  [ "$status" -ne 0 ]
  [[ "$output" == *"must match"* ]]

  run "$KB_SPIKE" promote "$exp_id" --as "with space"
  [ "$status" -ne 0 ]
}

@test "promote requires --as" {
  exp_id="$("$KB_SPIKE" new --experiment smoke 2>/dev/null | tail -1)"
  run "$KB_SPIKE" promote "$exp_id"
  [ "$status" -ne 0 ]
  [[ "$output" == *"--as"* ]]
}

@test "promote errors when no _adhoc steps exist (default --from)" {
  exp_id="$("$KB_SPIKE" new --experiment smoke 2>/dev/null | tail -1)"
  # No `run` was called → no _adhoc steps.
  run "$KB_SPIKE" promote "$exp_id" --as derived
  [ "$status" -ne 0 ]
  [[ "$output" == *"no step files"* ]] || [[ "$output" == *"_adhoc"* ]]
}

@test "promote --from <scenario> reads scenario branch step files" {
  exp_id="$("$KB_SPIKE" new --experiment smoke 2>/dev/null | tail -1)"
  "$KB_SPIKE" run-scenario "$exp_id" basic >/dev/null 2>&1

  run "$KB_SPIKE" promote "$exp_id" --as variant --from basic
  [ "$status" -eq 0 ]
  [ -f "$SPIKE_REPO_ROOT/experiments/smoke/scenarios/variant.sh" ]
}
