# scripts/spike/lib/assert.sh
#
# Assertion vocabulary for scenario observe() blocks.
#
# Each assertion is non-aborting: a failure is recorded and execution
# continues. The orchestrator inspects SPIKE_ASSERT_FAIL after observe()
# returns to decide pass/fail for the scenario.
#
# Globals:
#   SPIKE_ASSERT_TOTAL    — total assertions evaluated
#   SPIKE_ASSERT_PASS     — count of passing assertions
#   SPIKE_ASSERT_FAIL     — count of failing assertions
#   SPIKE_ASSERT_FAILURES — newline-separated failure messages
#
# Inputs read by assertions:
#   SPIKE_LAST_STEP_FILE  — JSON written by the most recent step()
#   SPIKE_INSTANCE        — root of the brain instance (for state/JSONL paths)

spike_assert_reset() {
  export SPIKE_ASSERT_TOTAL=0
  export SPIKE_ASSERT_PASS=0
  export SPIKE_ASSERT_FAIL=0
  export SPIKE_ASSERT_FAILURES=""
}

_spike_assert_pass() {
  SPIKE_ASSERT_TOTAL=$(( SPIKE_ASSERT_TOTAL + 1 ))
  SPIKE_ASSERT_PASS=$(( SPIKE_ASSERT_PASS + 1 ))
}

_spike_assert_fail() {
  local msg="$1"
  SPIKE_ASSERT_TOTAL=$(( SPIKE_ASSERT_TOTAL + 1 ))
  SPIKE_ASSERT_FAIL=$(( SPIKE_ASSERT_FAIL + 1 ))
  if [[ -z "$SPIKE_ASSERT_FAILURES" ]]; then
    SPIKE_ASSERT_FAILURES="$msg"
  else
    SPIKE_ASSERT_FAILURES+=$'\n'"$msg"
  fi
}

# ── LLM output (reads SPIKE_LAST_STEP_FILE.result) ───────────────

_spike_last_result() {
  if [[ -z "${SPIKE_LAST_STEP_FILE:-}" || ! -f "$SPIKE_LAST_STEP_FILE" ]]; then
    return 1
  fi
  jq -r '.result // empty' "$SPIKE_LAST_STEP_FILE"
}

assert_llm_contains() {
  local needle="$1" result
  if ! result="$(_spike_last_result)"; then
    _spike_assert_fail "assert_llm_contains \"$needle\": SPIKE_LAST_STEP_FILE missing or unset"
    return 0
  fi
  if [[ "$result" == *"$needle"* ]]; then
    _spike_assert_pass
  else
    _spike_assert_fail "assert_llm_contains \"$needle\": not found in last step output"
  fi
}

assert_llm_not_contains() {
  local needle="$1" result
  if ! result="$(_spike_last_result)"; then
    _spike_assert_fail "assert_llm_not_contains \"$needle\": SPIKE_LAST_STEP_FILE missing or unset"
    return 0
  fi
  if [[ "$result" != *"$needle"* ]]; then
    _spike_assert_pass
  else
    _spike_assert_fail "assert_llm_not_contains \"$needle\": unexpectedly present"
  fi
}

assert_llm_contains_any() {
  local result
  if ! result="$(_spike_last_result)"; then
    _spike_assert_fail "assert_llm_contains_any: SPIKE_LAST_STEP_FILE missing or unset"
    return 0
  fi
  local n
  for n in "$@"; do
    if [[ "$result" == *"$n"* ]]; then
      _spike_assert_pass
      return 0
    fi
  done
  _spike_assert_fail "assert_llm_contains_any: none of [$*] found"
}

assert_llm_contains_all() {
  local result
  if ! result="$(_spike_last_result)"; then
    _spike_assert_fail "assert_llm_contains_all: SPIKE_LAST_STEP_FILE missing or unset"
    return 0
  fi
  local missing="" n
  for n in "$@"; do
    if [[ "$result" != *"$n"* ]]; then
      missing+=" \"$n\""
    fi
  done
  if [[ -z "$missing" ]]; then
    _spike_assert_pass
  else
    _spike_assert_fail "assert_llm_contains_all: missing$missing"
  fi
}

assert_step_status_is() {
  local expected="$1"
  if [[ -z "${SPIKE_LAST_STEP_FILE:-}" || ! -f "$SPIKE_LAST_STEP_FILE" ]]; then
    _spike_assert_fail "assert_step_status_is \"$expected\": SPIKE_LAST_STEP_FILE missing or unset"
    return 0
  fi
  local actual
  actual="$(jq -r '.status // empty' "$SPIKE_LAST_STEP_FILE")"
  if [[ "$actual" == "$expected" ]]; then
    _spike_assert_pass
  else
    _spike_assert_fail "assert_step_status_is \"$expected\": got \"$actual\""
  fi
}

# ── Branch diff (vs. e2e/source tag in SPIKE_INSTANCE) ───────────

_spike_branch_diff_paths() {
  if [[ -z "${SPIKE_INSTANCE:-}" || ! -d "$SPIKE_INSTANCE/.git" ]]; then
    return 1
  fi
  ( cd "$SPIKE_INSTANCE" && git diff --name-only e2e/source HEAD ) 2>/dev/null
}

assert_branch_diff_empty() {
  local diff
  diff="$(_spike_branch_diff_paths || true)"
  if [[ -z "$diff" ]]; then
    _spike_assert_pass
  else
    _spike_assert_fail "assert_branch_diff_empty: unexpected changes:\n$diff"
  fi
}

assert_branch_diff_contains() {
  local path="$1" diff
  diff="$(_spike_branch_diff_paths || true)"
  if grep -qxF "$path" <<<"$diff"; then
    _spike_assert_pass
  else
    _spike_assert_fail "assert_branch_diff_contains \"$path\": not in diff"
  fi
}

assert_branch_diff_not_contains() {
  local path="$1" diff
  diff="$(_spike_branch_diff_paths || true)"
  if grep -qxF "$path" <<<"$diff"; then
    _spike_assert_fail "assert_branch_diff_not_contains \"$path\": unexpectedly present in diff"
  else
    _spike_assert_pass
  fi
}

# ── State file (JSON, queried via jq) ────────────────────────────

assert_state_file_field() {
  local rel_path="$1" jq_query="$2" expected="$3"
  local abs="$SPIKE_INSTANCE/$rel_path"
  if [[ ! -f "$abs" ]]; then
    _spike_assert_fail "assert_state_file_field \"$rel_path\": file missing"
    return 0
  fi
  local actual
  actual="$(jq -r "$jq_query // empty" "$abs" 2>/dev/null)" || actual=""
  if [[ "$actual" == "$expected" ]]; then
    _spike_assert_pass
  else
    _spike_assert_fail "assert_state_file_field \"$rel_path $jq_query\": expected \"$expected\", got \"$actual\""
  fi
}

# ── JSONL count ──────────────────────────────────────────────────

assert_jsonl_count() {
  local rel_path="$1" expected="$2"
  local abs="$SPIKE_INSTANCE/$rel_path"
  local actual=0
  if [[ -f "$abs" ]]; then
    actual="$(grep -c '' "$abs" 2>/dev/null || echo 0)"
  fi
  if [[ "$actual" -eq "$expected" ]]; then
    _spike_assert_pass
  else
    _spike_assert_fail "assert_jsonl_count \"$rel_path\": expected $expected, got $actual"
  fi
}

# ── Counter (counters.json convention) ───────────────────────────

assert_counter() {
  local name="$1" expected="$2"
  local abs="$SPIKE_INSTANCE/counters.json"
  local actual=0
  if [[ -f "$abs" ]]; then
    actual="$(jq -r --arg n "$name" '.[$n] // 0' "$abs" 2>/dev/null)" || actual=0
  fi
  if [[ "$actual" -eq "$expected" ]]; then
    _spike_assert_pass
  else
    _spike_assert_fail "assert_counter \"$name\": expected $expected, got $actual"
  fi
}

# Initialize on source so callers can use them without an explicit reset.
spike_assert_reset
