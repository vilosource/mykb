#!/usr/bin/env bats
#
# Tests for scripts/spike/lib/profile.sh
#
# spike_write_profile <exp_id> <instance>
#   Writes ~/.vf-agents/profiles/e2e-<exp_id>.yaml mounting:
#     - <instance>/.e2e-build/bundle as the Pi extension
#     - <instance> as /home/node/.mykb (the brain instance)
#   Refuses if instance is the sacred specimen.
#
# spike_remove_profile <exp_id>
#   Deletes the YAML if present.
#
# spike_profile_path <exp_id>
#   Echoes the path the profile lives at.

setup() {
  TMP=$(mktemp -d)
  INSTANCE="$TMP/instance"
  mkdir -p "$INSTANCE/.e2e-build/bundle"
  echo "// stub" > "$INSTANCE/.e2e-build/bundle/index.js"

  # Redirect VFA_HOME so we don't pollute the user's real profile dir.
  export VFA_HOME="$TMP/.vf-agents"
  mkdir -p "$VFA_HOME/profiles"

  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  source "$REPO_ROOT/scripts/spike/lib/profile.sh"
}

teardown() {
  rm -rf "$TMP"
  unset VFA_HOME
}

@test "spike_profile_path returns expected path under VFA_HOME/profiles" {
  run spike_profile_path "myexp-1"
  [ "$status" -eq 0 ]
  [ "$output" = "$VFA_HOME/profiles/e2e-myexp-1.yaml" ]
}

@test "spike_write_profile creates yaml with bundle and brain mounts" {
  run spike_write_profile "myexp-1" "$INSTANCE"
  [ "$status" -eq 0 ]
  yaml="$VFA_HOME/profiles/e2e-myexp-1.yaml"
  [ -f "$yaml" ]
  grep -q "id: e2e-myexp-1" "$yaml"
  grep -q "compatible_runtimes:" "$yaml"
  grep -qF "$INSTANCE/.e2e-build/bundle" "$yaml"
  grep -qF "$INSTANCE:/home/node/.mykb" "$yaml"
  grep -q "mount: /home/node/.pi/agent/extensions/mykb" "$yaml"
}

@test "spike_write_profile refuses sacred specimen as instance" {
  run spike_write_profile "evil" "$HOME/.mykb"
  [ "$status" -ne 0 ]
  [[ "$output" == *"sacred"* ]] || [[ "$output" == *"specimen"* ]]
}

@test "spike_write_profile refuses sacred specimen with trailing slash" {
  run spike_write_profile "evil" "$HOME/.mykb/"
  [ "$status" -ne 0 ]
}

@test "spike_write_profile refuses when instance does not exist" {
  run spike_write_profile "x" "$TMP/nope"
  [ "$status" -ne 0 ]
}

@test "spike_write_profile refuses when captured bundle missing" {
  rm -rf "$INSTANCE/.e2e-build/bundle"
  run spike_write_profile "x" "$INSTANCE"
  [ "$status" -ne 0 ]
  [[ "$output" == *"bundle"* ]] || [[ "$output" == *"capture"* ]]
}

@test "spike_remove_profile deletes the yaml" {
  spike_write_profile "rm-me" "$INSTANCE"
  yaml="$VFA_HOME/profiles/e2e-rm-me.yaml"
  [ -f "$yaml" ]
  run spike_remove_profile "rm-me"
  [ "$status" -eq 0 ]
  [ ! -f "$yaml" ]
}

@test "spike_remove_profile is idempotent (no error if absent)" {
  run spike_remove_profile "never-existed"
  [ "$status" -eq 0 ]
}

@test "spike_write_profile honors SPIKE_VFA_TIMEOUT env var" {
  SPIKE_VFA_TIMEOUT=240 spike_write_profile "tmt" "$INSTANCE"
  yaml="$VFA_HOME/profiles/e2e-tmt.yaml"
  grep -q "timeout: 240" "$yaml"
}

@test "spike_write_profile errors with usage when missing args" {
  run spike_write_profile
  [ "$status" -ne 0 ]
  run spike_write_profile "x"
  [ "$status" -ne 0 ]
}
