#!/usr/bin/env bats
#
# Tests for scripts/spike/lib/meta.sh
#
# spike_write_meta <instance>
#   Writes <instance>/.e2e-meta.json from environment variables:
#     SPIKE_EXP_ID, SPIKE_EXPERIMENT, SPIKE_INTENT, SPIKE_SPECIMEN,
#     SPIKE_SOURCE_COMMIT, SPIKE_PROFILE_PATH.
#   Adds created_at automatically.
#
# spike_read_meta <instance> <field>
#   Reads a field from .e2e-meta.json via jq. Empty string if missing.

setup() {
  TMP=$(mktemp -d)
  INSTANCE="$TMP/instance"
  mkdir -p "$INSTANCE"
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  source "$REPO_ROOT/scripts/spike/lib/meta.sh"
}

teardown() {
  rm -rf "$TMP"
}

@test "spike_write_meta writes .e2e-meta.json with expected fields" {
  SPIKE_EXP_ID="journal-auto-inject-20260509-1200" \
    SPIKE_EXPERIMENT="journal-auto-inject" \
    SPIKE_INTENT="probe resume continuity" \
    SPIKE_SPECIMEN="$HOME/.mykb" \
    SPIKE_SOURCE_COMMIT="abc123" \
    SPIKE_PROFILE_PATH="$HOME/.vf-agents/profiles/e2e-test.yaml" \
    spike_write_meta "$INSTANCE"
  meta="$INSTANCE/.e2e-meta.json"
  [ -f "$meta" ]
  [ "$(jq -r .exp_id "$meta")" = "journal-auto-inject-20260509-1200" ]
  [ "$(jq -r .experiment "$meta")" = "journal-auto-inject" ]
  [ "$(jq -r .intent "$meta")" = "probe resume continuity" ]
  [ "$(jq -r .specimen "$meta")" = "$HOME/.mykb" ]
  [ "$(jq -r .source_commit "$meta")" = "abc123" ]
  [ "$(jq -r .profile_path "$meta")" = "$HOME/.vf-agents/profiles/e2e-test.yaml" ]
  [ -n "$(jq -r .created_at "$meta")" ]
}

@test "spike_write_meta refuses when required field missing" {
  unset SPIKE_EXP_ID SPIKE_EXPERIMENT SPIKE_INTENT SPIKE_SPECIMEN \
        SPIKE_SOURCE_COMMIT SPIKE_PROFILE_PATH
  run spike_write_meta "$INSTANCE"
  [ "$status" -ne 0 ]
}

@test "spike_write_meta refuses when instance does not exist" {
  SPIKE_EXP_ID=a SPIKE_EXPERIMENT=b SPIKE_INTENT=c SPIKE_SPECIMEN=d \
    SPIKE_SOURCE_COMMIT=e SPIKE_PROFILE_PATH=f \
    run spike_write_meta "$TMP/nonesuch"
  [ "$status" -ne 0 ]
}

@test "spike_read_meta returns field value" {
  cat > "$INSTANCE/.e2e-meta.json" <<'JSON'
{"exp_id":"x1","experiment":"feat","intent":"hi","specimen":"/home/a/.mykb"}
JSON
  run spike_read_meta "$INSTANCE" exp_id
  [ "$status" -eq 0 ]
  [ "$output" = "x1" ]
  run spike_read_meta "$INSTANCE" experiment
  [ "$output" = "feat" ]
}

@test "spike_read_meta returns empty for missing field" {
  echo '{"exp_id":"x"}' > "$INSTANCE/.e2e-meta.json"
  run spike_read_meta "$INSTANCE" intent
  [ "$status" -eq 0 ]
  [ -z "$output" ] || [ "$output" = "null" ] || [ "$output" = "" ]
}

@test "spike_read_meta errors when meta file missing" {
  run spike_read_meta "$INSTANCE" exp_id
  [ "$status" -ne 0 ]
}

@test "spike_read_meta errors with usage when missing args" {
  run spike_read_meta
  [ "$status" -ne 0 ]
  run spike_read_meta "$INSTANCE"
  [ "$status" -ne 0 ]
}
