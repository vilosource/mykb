#!/usr/bin/env bats
#
# Bats tests for scripts/spike/lib/clone.sh
#
# spike_clone_specimen <specimen_path> <instance_path>
#   - Clones specimen into instance, tags e2e/source on the cloned HEAD.
#   - Refuses if instance_path already exists.
#   - Refuses ~/.mykb (or any path equal to $HOME/.mykb) — the specimen is sacred.
#   - Refuses non-existent specimen.
#   - Refuses specimen that isn't a git repo.

setup() {
  TMP=$(mktemp -d)
  SPECIMEN="$TMP/specimen"
  INSTANCE="$TMP/instance"
  mkdir -p "$SPECIMEN"
  (
    cd "$SPECIMEN"
    git init -q -b main
    git config user.email "test@example.com"
    git config user.name "test"
    echo "hello" > a.txt
    git add a.txt
    git commit -q -m "init"
  )
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  source "$REPO_ROOT/scripts/spike/lib/clone.sh"
}

teardown() {
  rm -rf "$TMP"
}

@test "spike_clone_specimen creates instance with git history" {
  run spike_clone_specimen "$SPECIMEN" "$INSTANCE"
  [ "$status" -eq 0 ]
  [ -d "$INSTANCE/.git" ]
  [ -f "$INSTANCE/a.txt" ]
}

@test "spike_clone_specimen tags e2e/source on cloned HEAD" {
  spike_clone_specimen "$SPECIMEN" "$INSTANCE"
  cd "$INSTANCE"
  run git rev-parse --verify e2e/source
  [ "$status" -eq 0 ]

  # The tag should point at the same commit as HEAD.
  expected="$(git rev-parse HEAD)"
  actual="$(git rev-parse e2e/source^{commit})"
  [ "$expected" = "$actual" ]
}

@test "spike_clone_specimen refuses when instance already exists" {
  mkdir -p "$INSTANCE"
  run spike_clone_specimen "$SPECIMEN" "$INSTANCE"
  [ "$status" -ne 0 ]
  [[ "$output" == *"already exists"* ]]
}

@test "spike_clone_specimen refuses \$HOME/.mykb as instance (sacred)" {
  run spike_clone_specimen "$SPECIMEN" "$HOME/.mykb"
  [ "$status" -ne 0 ]
  [[ "$output" == *"sacred"* ]] || [[ "$output" == *"specimen"* ]]
}

@test "spike_clone_specimen refuses \$HOME/.mykb with trailing slash" {
  run spike_clone_specimen "$SPECIMEN" "$HOME/.mykb/"
  [ "$status" -ne 0 ]
  [[ "$output" == *"sacred"* ]] || [[ "$output" == *"specimen"* ]]
}

@test "spike_clone_specimen refuses non-existent specimen" {
  run spike_clone_specimen "/no/such/path" "$INSTANCE"
  [ "$status" -ne 0 ]
  [[ "$output" == *"not found"* ]] || [[ "$output" == *"does not exist"* ]]
}

@test "spike_clone_specimen refuses specimen that isn't a git repo" {
  notrepo="$TMP/notrepo"
  mkdir -p "$notrepo"
  run spike_clone_specimen "$notrepo" "$INSTANCE"
  [ "$status" -ne 0 ]
  [[ "$output" == *"not a git"* ]] || [[ "$output" == *"git repo"* ]]
}

@test "spike_clone_specimen creates instance parent dir if missing" {
  nested="$TMP/a/b/c/instance"
  run spike_clone_specimen "$SPECIMEN" "$nested"
  [ "$status" -eq 0 ]
  [ -d "$nested/.git" ]
}

@test "spike_clone_specimen errors with usage when missing args" {
  run spike_clone_specimen
  [ "$status" -ne 0 ]
  run spike_clone_specimen "$SPECIMEN"
  [ "$status" -ne 0 ]
}
