# scripts/spike/lib/profile.sh
#
# Generate the per-experiment vfa profile YAML.
#
# Provides:
#   spike_profile_path  <exp_id>
#   spike_write_profile <exp_id> <instance>
#   spike_remove_profile <exp_id>
#
# The profile mounts the captured Pi extension bundle (frozen at
# spike_capture_build time) and the brain instance dir as /home/node/.mykb.
# It is generated once per experiment and removed at discard time.

# Resolve the vfa profiles directory. vfa honors VFA_HOME for its config
# root; we read the same env var so tests can redirect it.
_spike_profiles_dir() {
  printf '%s' "${VFA_HOME:-$HOME/.vf-agents}/profiles"
}

# Same sacred-path check as clone.sh, kept local to avoid coupling. Could
# be lifted into a shared lib if a third caller appears.
_spike_profile_is_sacred_path() {
  local p="$1" specimen
  specimen="$HOME/.mykb"
  while [[ "$p" == */ && "$p" != "/" ]]; do p="${p%/}"; done
  [[ "$p" == "$specimen" ]] && return 0
  if [[ -e "$p" ]]; then
    local resolved
    resolved="$(readlink -f "$p" 2>/dev/null)" || resolved=""
    [[ "$resolved" == "$specimen" ]] && return 0
  fi
  return 1
}

spike_profile_path() {
  if [[ $# -ne 1 ]]; then
    echo "spike_profile_path: usage: spike_profile_path <exp_id>" >&2
    return 2
  fi
  printf '%s/e2e-%s.yaml' "$(_spike_profiles_dir)" "$1"
}

spike_write_profile() {
  if [[ $# -ne 2 ]]; then
    echo "spike_write_profile: usage: spike_write_profile <exp_id> <instance>" >&2
    return 2
  fi
  local exp_id="$1" instance="$2"

  if _spike_profile_is_sacred_path "$instance"; then
    echo "spike_write_profile: refuse to mount specimen (sacred): $instance" >&2
    return 1
  fi
  if [[ ! -d "$instance" ]]; then
    echo "spike_write_profile: instance does not exist: $instance" >&2
    return 1
  fi

  local profiles_dir
  profiles_dir="$(_spike_profiles_dir)"
  mkdir -p "$profiles_dir"

  local timeout="${SPIKE_VFA_TIMEOUT:-120}"
  local yaml
  yaml="$(spike_profile_path "$exp_id")"

  # Two runtimes today, two profile shapes:
  #   pi: the kb extension bundle is mounted as a Pi plugin; auto-injection
  #       (system prompt + per-turn context) and registered tools come for
  #       free via the extension's lifecycle hooks.
  #   claude-code: there's no kb extension; auto-injection is achieved via
  #       SessionStart / UserPromptSubmit hooks declared in
  #       <workdir>/.claude/settings.json. The hook scripts shell out to
  #       the captured kb CLI (mounted at /opt/mykb-cli) and emit JSON
  #       with `additionalContext` to inject for the LLM.
  local runtime="${SPIKE_RUNTIME:-pi}"

  case "$runtime" in
    pi)
      local bundle="$instance/.e2e-build/bundle"
      if [[ ! -d "$bundle" || ! -f "$bundle/index.js" ]]; then
        echo "spike_write_profile: captured bundle missing at $bundle (run spike_capture_build first)" >&2
        return 1
      fi
      cat > "$yaml" <<EOF
id: e2e-${exp_id}
description: "kb-spike experiment instance: ${exp_id}"
compatible_runtimes: [pi]
workspace:
  type: ephemeral
  mount_path: /workspace
mode: headless
output_format: json
timeout: ${timeout}
plugins:
  pi:
    - source: ${bundle}
      mount: /home/node/.pi/agent/extensions/mykb
extra_volumes:
  - "${instance}:/home/node/.mykb"
EOF
      ;;
    claude-code)
      local cli="$instance/.e2e-build/cli"
      local workdir="$instance/.e2e-workdir"
      if [[ ! -d "$cli" || ! -f "$cli/cli.js" ]]; then
        echo "spike_write_profile: captured cli missing at $cli (run spike_capture_build first)" >&2
        return 1
      fi
      if [[ ! -d "$workdir" ]]; then
        echo "spike_write_profile: workdir-seed missing at $workdir (run spike_seed_workdir first)" >&2
        return 1
      fi
      # workdir.type: persistent + source mounts our seed dir directly
      # as /workspace inside the container (so .claude/settings.json is
      # in the project root claude-code expects). Mounting via
      # extra_volumes alongside an ephemeral workdir created two binds
      # to /workspace and the ephemeral won — hooks were never read.
      cat > "$yaml" <<EOF
id: e2e-${exp_id}
description: "kb-spike experiment instance: ${exp_id} (claude-code)"
compatible_runtimes: [claude-code]
workdir:
  type: persistent
  source: ${workdir}
  mount_path: /workspace
mode: headless
output_format: json
timeout: ${timeout}
extra_volumes:
  - "${instance}:/home/node/.mykb"
  - "${cli}:/opt/mykb-cli"
EOF
      ;;
    *)
      echo "spike_write_profile: unsupported runtime: $runtime" >&2
      return 1
      ;;
  esac
}

spike_remove_profile() {
  if [[ $# -ne 1 ]]; then
    echo "spike_remove_profile: usage: spike_remove_profile <exp_id>" >&2
    return 2
  fi
  local yaml
  yaml="$(spike_profile_path "$1")"
  [[ -f "$yaml" ]] && rm -f "$yaml"
  return 0
}
