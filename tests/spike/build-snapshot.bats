#!/usr/bin/env bats
#
# Tests for scripts/spike/lib/build-snapshot.sh
#
# spike_capture_build <repo_root> <instance_path>
#   Copies dist/bundle/index.js + dist/cli/cli.js into <instance>/.e2e-build/
#   {bundle/index.js, cli/cli.js}, plus build-meta.json (commit, dirty flag).
#
# spike_rebuild_instance <instance_path>
#   Runs `node <instance>/.e2e-build/cli/cli.js rebuild` with MYKB_DIR set
#   to the instance — regenerates the SQLite mirror from JSONL.

setup() {
  TMP=$(mktemp -d)
  REPO="$TMP/repo"
  INSTANCE="$TMP/instance"

  mkdir -p "$REPO/dist/bundle" "$REPO/dist/cli-bundle"
  echo "// fake bundle" > "$REPO/dist/bundle/index.js"
  echo "// fake cli" > "$REPO/dist/cli-bundle/cli.js"
  (
    cd "$REPO"
    git init -q -b main
    git config user.email "test@example.com"
    git config user.name "test"
    echo "x" > README
    git add README
    git commit -q -m "init"
  )
  mkdir -p "$INSTANCE"

  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  source "$REPO_ROOT/scripts/spike/lib/build-snapshot.sh"
}

teardown() {
  rm -rf "$TMP"
}

@test "spike_capture_build copies bundle and cli into .e2e-build/" {
  run spike_capture_build "$REPO" "$INSTANCE"
  [ "$status" -eq 0 ]
  [ -f "$INSTANCE/.e2e-build/bundle/index.js" ]
  [ -f "$INSTANCE/.e2e-build/cli/cli.js" ]
  grep -q "fake bundle" "$INSTANCE/.e2e-build/bundle/index.js"
  grep -q "fake cli" "$INSTANCE/.e2e-build/cli/cli.js"
}

@test "spike_capture_build writes build-meta.json with commit + dirty flag" {
  spike_capture_build "$REPO" "$INSTANCE"
  meta="$INSTANCE/.e2e-build/build-meta.json"
  [ -f "$meta" ]
  expected="$(cd "$REPO" && git rev-parse HEAD)"
  actual="$(jq -r .build_commit "$meta")"
  [ "$expected" = "$actual" ]
  [ "$(jq -r .build_dirty "$meta")" = "false" ]
}

@test "spike_capture_build flags dirty when tracked files modified" {
  echo "modified" >> "$REPO/README"
  spike_capture_build "$REPO" "$INSTANCE"
  [ "$(jq -r .build_dirty "$INSTANCE/.e2e-build/build-meta.json")" = "true" ]
}

@test "spike_capture_build refuses when bundle is missing" {
  rm "$REPO/dist/bundle/index.js"
  run spike_capture_build "$REPO" "$INSTANCE"
  [ "$status" -ne 0 ]
  [[ "$output" == *"bundle"* ]]
}

@test "spike_capture_build refuses when cli bundle is missing" {
  rm "$REPO/dist/cli-bundle/cli.js"
  run spike_capture_build "$REPO" "$INSTANCE"
  [ "$status" -ne 0 ]
  [[ "$output" == *"cli"* ]]
}

@test "spike_capture_build errors with usage when missing args" {
  run spike_capture_build
  [ "$status" -ne 0 ]
  run spike_capture_build "$REPO"
  [ "$status" -ne 0 ]
}

@test "spike_capture_build refuses if instance does not exist" {
  run spike_capture_build "$REPO" "$TMP/nonesuch"
  [ "$status" -ne 0 ]
}

@test "spike_rebuild_instance invokes captured cli with MYKB_DIR=instance" {
  # Replace the fake cli with a stub that echoes its env.
  spike_capture_build "$REPO" "$INSTANCE"
  cat > "$INSTANCE/.e2e-build/cli/cli.js" <<'EOF'
console.log("MYKB_DIR=" + (process.env.MYKB_DIR || ""));
console.log("argv=" + process.argv.slice(2).join(","));
EOF
  run spike_rebuild_instance "$INSTANCE"
  [ "$status" -eq 0 ]
  [[ "$output" == *"MYKB_DIR=$INSTANCE"* ]]
  [[ "$output" == *"argv=rebuild"* ]]
}

@test "spike_rebuild_instance fails when captured cli is missing" {
  run spike_rebuild_instance "$INSTANCE"
  [ "$status" -ne 0 ]
  [[ "$output" == *"not captured"* ]] || [[ "$output" == *"cli.js"* ]]
}

@test "spike_rebuild_instance propagates non-zero exit from cli" {
  spike_capture_build "$REPO" "$INSTANCE"
  cat > "$INSTANCE/.e2e-build/cli/cli.js" <<'EOF'
process.exit(7);
EOF
  run spike_rebuild_instance "$INSTANCE"
  [ "$status" -ne 0 ]
}
