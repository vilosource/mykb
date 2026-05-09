# scripts/spike/lib/build-snapshot.sh
#
# Capture the kb build (Pi extension bundle + CLI) into a per-experiment
# directory inside the brain instance, and use the captured CLI to rebuild
# the SQLite mirror in the instance.
#
# Provides:
#   spike_capture_build <repo_root> <instance_path>
#   spike_rebuild_instance <instance_path>
#
# Why per-experiment capture: a parallel `git checkout` (or another agent
# rebuilding) on the working tree must not change what an in-flight
# experiment is testing. The build under test is whatever was in dist/ at
# `kb-spike new` time, frozen here.
#
# Boundary: only spike_rebuild_instance invokes the captured cli (one-shot
# bootstrap of the SQLite mirror). The host's `kb` is never called.

spike_capture_build() {
  if [[ $# -ne 2 ]]; then
    echo "spike_capture_build: usage: spike_capture_build <repo_root> <instance>" >&2
    return 2
  fi
  local repo="$1" instance="$2"

  if [[ ! -d "$instance" ]]; then
    echo "spike_capture_build: instance does not exist: $instance" >&2
    return 1
  fi

  # The Pi extension bundle (esbuild --bundle) lives at dist/bundle/.
  # The CLI ships in two forms: dist/cli/ (tsc, unbundled, broken when
  # copied because better-sqlite3 isn't resolvable) and dist/cli-bundle/
  # (esbuild --bundle --format=esm, complete with package.json declaring
  # type:module and node_modules/better-sqlite3). We always capture from
  # cli-bundle so the captured tree is self-contained.
  local bundle_src="$repo/dist/bundle/index.js"
  local cli_src="$repo/dist/cli-bundle/cli.js"

  if [[ ! -f "$bundle_src" ]]; then
    echo "spike_capture_build: bundle missing — run 'npm run bundle' first ($bundle_src)" >&2
    return 1
  fi
  if [[ ! -f "$cli_src" ]]; then
    echo "spike_capture_build: cli bundle missing — run 'npm run bundle:cli' first ($cli_src)" >&2
    return 1
  fi

  local out="$instance/.e2e-build"
  mkdir -p "$out/bundle" "$out/cli"

  # Bundle: copy index.js + package.json (so the Pi runtime sees the
  # extension entrypoint correctly).
  cp "$bundle_src" "$out/bundle/index.js"
  if [[ -f "$repo/dist/bundle/package.json" ]]; then
    cp "$repo/dist/bundle/package.json" "$out/bundle/package.json"
  fi

  # CLI bundle: copy cli.js, its package.json, and node_modules so the
  # captured CLI runs standalone with `node cli.js`.
  cp "$cli_src" "$out/cli/cli.js"
  if [[ -f "$repo/dist/cli-bundle/package.json" ]]; then
    cp "$repo/dist/cli-bundle/package.json" "$out/cli/package.json"
  fi
  if [[ -d "$repo/dist/cli-bundle/node_modules" ]]; then
    cp -r "$repo/dist/cli-bundle/node_modules" "$out/cli/node_modules"
  fi

  # Provenance: which commit produced the build, and was the working tree
  # dirty at capture time. Operators reading post-mortem need this to
  # reproduce.
  local commit dirty="false"
  if [[ -d "$repo/.git" ]]; then
    commit="$(cd "$repo" && git rev-parse HEAD 2>/dev/null)" || commit=""
    if (cd "$repo" && ! git diff --quiet 2>/dev/null) \
       || (cd "$repo" && ! git diff --cached --quiet 2>/dev/null); then
      dirty="true"
    fi
  else
    commit=""
  fi

  jq -n \
    --arg commit "$commit" \
    --argjson dirty "$dirty" \
    --arg captured_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    '{build_commit: $commit, build_dirty: $dirty, captured_at: $captured_at}' \
    > "$out/build-meta.json"
}

spike_rebuild_instance() {
  if [[ $# -ne 1 ]]; then
    echo "spike_rebuild_instance: usage: spike_rebuild_instance <instance>" >&2
    return 2
  fi
  local instance="$1"
  local cli="$instance/.e2e-build/cli/cli.js"

  if [[ ! -f "$cli" ]]; then
    echo "spike_rebuild_instance: captured cli not found at $cli (run spike_capture_build first)" >&2
    return 1
  fi

  MYKB_DIR="$instance" node "$cli" rebuild
}
