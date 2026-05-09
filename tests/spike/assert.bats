#!/usr/bin/env bats
#
# Tests for scripts/spike/lib/assert.sh
#
# Assertions accumulate into SPIKE_ASSERT_PASS / SPIKE_ASSERT_FAIL
# counters and SPIKE_ASSERT_FAILURES (newline-delimited messages).
# An assertion never aborts the scenario — observe() runs all of them
# so the operator gets the full failure picture in one pass.
#
# LLM-output assertions read SPIKE_LAST_STEP_FILE (set by step()).
# Branch-diff assertions read git in SPIKE_INSTANCE.
# State-file/JSONL assertions read paths relative to SPIKE_INSTANCE.

setup() {
  TMP=$(mktemp -d)
  INSTANCE="$TMP/instance"
  mkdir -p "$INSTANCE"
  (
    cd "$INSTANCE"
    git init -q -b main
    git config user.email t@t
    git config user.name t
    echo "seed" > seed.txt
    git add seed.txt
    git commit -q -m "init"
    git tag e2e/source HEAD
  )
  export SPIKE_INSTANCE="$INSTANCE"

  # A minimal step file the LLM-output assertions can read.
  STEP_FILE="$INSTANCE/.e2e-steps/scn/001-probe.json"
  mkdir -p "$(dirname "$STEP_FILE")"
  cat > "$STEP_FILE" <<'JSON'
{"result":"hello world from the LLM","status":"completed"}
JSON
  export SPIKE_LAST_STEP_FILE="$STEP_FILE"

  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  source "$REPO_ROOT/scripts/spike/lib/assert.sh"

  spike_assert_reset
}

teardown() {
  rm -rf "$TMP"
  unset SPIKE_INSTANCE SPIKE_LAST_STEP_FILE \
        SPIKE_ASSERT_TOTAL SPIKE_ASSERT_PASS SPIKE_ASSERT_FAIL SPIKE_ASSERT_FAILURES
}

# ── LLM output ──────────────────────────────────────────────────

@test "assert_llm_contains passes when marker present" {
  assert_llm_contains "hello"
  [ "$SPIKE_ASSERT_PASS" -eq 1 ]
  [ "$SPIKE_ASSERT_FAIL" -eq 0 ]
}

@test "assert_llm_contains records failure when marker absent" {
  assert_llm_contains "nope_marker"
  [ "$SPIKE_ASSERT_PASS" -eq 0 ]
  [ "$SPIKE_ASSERT_FAIL" -eq 1 ]
  [[ "$SPIKE_ASSERT_FAILURES" == *"nope_marker"* ]]
}

@test "assert_llm_not_contains passes when marker absent" {
  assert_llm_not_contains "elephant"
  [ "$SPIKE_ASSERT_PASS" -eq 1 ]
  [ "$SPIKE_ASSERT_FAIL" -eq 0 ]
}

@test "assert_llm_not_contains records failure when marker present" {
  assert_llm_not_contains "hello"
  [ "$SPIKE_ASSERT_FAIL" -eq 1 ]
}

@test "assert_llm_contains_any passes when at least one matches" {
  assert_llm_contains_any "no" "hello" "also_no"
  [ "$SPIKE_ASSERT_PASS" -eq 1 ]
}

@test "assert_llm_contains_any fails when none match" {
  assert_llm_contains_any "no1" "no2" "no3"
  [ "$SPIKE_ASSERT_FAIL" -eq 1 ]
}

@test "assert_llm_contains_all passes when all match" {
  assert_llm_contains_all "hello" "world"
  [ "$SPIKE_ASSERT_PASS" -eq 1 ]
}

@test "assert_llm_contains_all fails when one missing" {
  assert_llm_contains_all "hello" "MISSING"
  [ "$SPIKE_ASSERT_FAIL" -eq 1 ]
  [[ "$SPIKE_ASSERT_FAILURES" == *"MISSING"* ]]
}

@test "assert_step_status_is passes for matching status" {
  assert_step_status_is "completed"
  [ "$SPIKE_ASSERT_PASS" -eq 1 ]
}

@test "assert_step_status_is fails for non-matching status" {
  assert_step_status_is "failed"
  [ "$SPIKE_ASSERT_FAIL" -eq 1 ]
}

@test "LLM assertions fail loudly if SPIKE_LAST_STEP_FILE is unset" {
  unset SPIKE_LAST_STEP_FILE
  assert_llm_contains "anything"
  [ "$SPIKE_ASSERT_FAIL" -eq 1 ]
}

# ── Branch diff (state changes from e2e/source) ─────────────────

@test "assert_branch_diff_empty passes when no changes from e2e/source" {
  assert_branch_diff_empty
  [ "$SPIKE_ASSERT_PASS" -eq 1 ]
}

@test "assert_branch_diff_empty fails when changes present" {
  (cd "$INSTANCE" && echo "more" > new.txt && git add new.txt && git commit -q -m new)
  assert_branch_diff_empty
  [ "$SPIKE_ASSERT_FAIL" -eq 1 ]
}

@test "assert_branch_diff_contains passes for changed path" {
  (cd "$INSTANCE" && echo "more" > new.txt && git add new.txt && git commit -q -m new)
  assert_branch_diff_contains "new.txt"
  [ "$SPIKE_ASSERT_PASS" -eq 1 ]
}

@test "assert_branch_diff_contains fails for unchanged path" {
  assert_branch_diff_contains "new.txt"
  [ "$SPIKE_ASSERT_FAIL" -eq 1 ]
}

@test "assert_branch_diff_not_contains passes when path untouched" {
  assert_branch_diff_not_contains "untouched.txt"
  [ "$SPIKE_ASSERT_PASS" -eq 1 ]
}

@test "assert_branch_diff_not_contains fails when path was touched" {
  (cd "$INSTANCE" && echo "x" > touched.txt && git add touched.txt && git commit -q -m t)
  assert_branch_diff_not_contains "touched.txt"
  [ "$SPIKE_ASSERT_FAIL" -eq 1 ]
}

# ── State file (JSON via jq) ─────────────────────────────────────

@test "assert_state_file_field passes for matching value" {
  echo '{"phase":"infra-setup"}' > "$INSTANCE/state.json"
  assert_state_file_field "state.json" ".phase" "infra-setup"
  [ "$SPIKE_ASSERT_PASS" -eq 1 ]
}

@test "assert_state_file_field fails for mismatched value" {
  echo '{"phase":"design"}' > "$INSTANCE/state.json"
  assert_state_file_field "state.json" ".phase" "infra-setup"
  [ "$SPIKE_ASSERT_FAIL" -eq 1 ]
}

@test "assert_state_file_field fails when file missing" {
  assert_state_file_field "missing.json" ".phase" "x"
  [ "$SPIKE_ASSERT_FAIL" -eq 1 ]
}

# ── JSONL count ──────────────────────────────────────────────────

@test "assert_jsonl_count passes for matching count" {
  printf '{"a":1}\n{"a":2}\n{"a":3}\n' > "$INSTANCE/foo.jsonl"
  assert_jsonl_count "foo.jsonl" 3
  [ "$SPIKE_ASSERT_PASS" -eq 1 ]
}

@test "assert_jsonl_count fails for mismatched count" {
  printf '{"a":1}\n' > "$INSTANCE/foo.jsonl"
  assert_jsonl_count "foo.jsonl" 5
  [ "$SPIKE_ASSERT_FAIL" -eq 1 ]
}

@test "assert_jsonl_count treats missing file as count 0" {
  assert_jsonl_count "missing.jsonl" 0
  [ "$SPIKE_ASSERT_PASS" -eq 1 ]
  assert_jsonl_count "missing.jsonl" 1
  [ "$SPIKE_ASSERT_FAIL" -eq 1 ]
}

# ── Counter (counters.json convention) ───────────────────────────

@test "assert_counter passes for matching counter value" {
  echo '{"hits":7}' > "$INSTANCE/counters.json"
  assert_counter "hits" 7
  [ "$SPIKE_ASSERT_PASS" -eq 1 ]
}

@test "assert_counter fails for mismatched counter value" {
  echo '{"hits":7}' > "$INSTANCE/counters.json"
  assert_counter "hits" 0
  [ "$SPIKE_ASSERT_FAIL" -eq 1 ]
}

@test "assert_counter treats missing counter as 0" {
  assert_counter "ghosts" 0
  [ "$SPIKE_ASSERT_PASS" -eq 1 ]
  assert_counter "ghosts" 1
  [ "$SPIKE_ASSERT_FAIL" -eq 1 ]
}

# ── Reset / accumulation ─────────────────────────────────────────

@test "spike_assert_reset zeroes counters and clears failures" {
  assert_llm_contains "no"
  [ "$SPIKE_ASSERT_FAIL" -eq 1 ]
  spike_assert_reset
  [ "$SPIKE_ASSERT_FAIL" -eq 0 ]
  [ "$SPIKE_ASSERT_PASS" -eq 0 ]
  [ "$SPIKE_ASSERT_TOTAL" -eq 0 ]
  [ -z "$SPIKE_ASSERT_FAILURES" ]
}

@test "assertions accumulate across calls" {
  assert_llm_contains "hello"
  assert_llm_contains "world"
  assert_llm_contains "MISSING"
  [ "$SPIKE_ASSERT_PASS" -eq 2 ]
  [ "$SPIKE_ASSERT_FAIL" -eq 1 ]
  [ "$SPIKE_ASSERT_TOTAL" -eq 3 ]
}
