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

  # Bundle: copy index.js + package.json + node_modules. The bundle is
  # esbuild-built with --external:better-sqlite3, so the runtime needs
  # the native module installed alongside.
  cp "$bundle_src" "$out/bundle/index.js"
  if [[ -f "$repo/dist/bundle/package.json" ]]; then
    cp "$repo/dist/bundle/package.json" "$out/bundle/package.json"
  fi
  if [[ -d "$repo/dist/bundle/node_modules" ]]; then
    cp -r "$repo/dist/bundle/node_modules" "$out/bundle/node_modules"
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

# Seed the per-experiment workdir for claude-code runtime experiments.
# Copies the repo's hooks/claude-code/ tree into <instance>/.e2e-workdir/
# laid out as a project root with .claude/settings.json + .claude/hooks/.
# The kb-spike profile mounts this dir as /workspace inside the
# Claude Code container, so the hooks fire with the right paths.
spike_seed_workdir() {
  if [[ $# -ne 2 ]]; then
    echo "spike_seed_workdir: usage: spike_seed_workdir <repo_root> <instance>" >&2
    return 2
  fi
  local repo="$1" instance="$2"

  if [[ ! -d "$instance" ]]; then
    echo "spike_seed_workdir: instance does not exist: $instance" >&2
    return 1
  fi
  local hooks_src="$repo/hooks/claude-code"
  if [[ ! -d "$hooks_src" ]]; then
    echo "spike_seed_workdir: hooks dir missing at $hooks_src" >&2
    return 1
  fi
  if [[ ! -f "$hooks_src/session-start.sh" ]]; then
    echo "spike_seed_workdir: session-start.sh missing in $hooks_src" >&2
    return 1
  fi
  if [[ ! -f "$hooks_src/settings.template.json" ]]; then
    echo "spike_seed_workdir: settings.template.json missing in $hooks_src" >&2
    return 1
  fi

  local seed="$instance/.e2e-workdir"
  mkdir -p "$seed/.claude/hooks"
  cp "$hooks_src/session-start.sh" "$seed/.claude/hooks/session-start.sh"
  chmod +x "$seed/.claude/hooks/session-start.sh"
  cp "$hooks_src/settings.template.json" "$seed/.claude/settings.json"

  # Always create an empty .kb-context.md so vfa's claude adapter can
  # unconditionally pass --append-system-prompt-file pointing at it.
  # Scenarios overwrite this file with `spike_export_context` (defined
  # in step.sh) when they need the LLM to see the workspace state at
  # session start.
  : > "$seed/.kb-context.md"
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
