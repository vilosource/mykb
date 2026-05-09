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

  local bundle="$instance/.e2e-build/bundle"
  if [[ ! -d "$bundle" || ! -f "$bundle/index.js" ]]; then
    echo "spike_write_profile: captured bundle missing at $bundle (run spike_capture_build first)" >&2
    return 1
  fi

  local profiles_dir
  profiles_dir="$(_spike_profiles_dir)"
  mkdir -p "$profiles_dir"

  local timeout="${SPIKE_VFA_TIMEOUT:-120}"
  local yaml
  yaml="$(spike_profile_path "$exp_id")"

  # Heredoc with explicit string substitutions. Mode/format mirror the
  # existing profiles in ~/.vf-agents/profiles/ so vfa accepts the schema.
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
