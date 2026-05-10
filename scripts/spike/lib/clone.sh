# scripts/spike/lib/clone.sh
#
# Brain instance creation. Sourced by the harness; never executed directly.
#
# Provides:
#   spike_clone_specimen <specimen_path> <instance_path>
#
# The specimen (~/.mykb) is sacred — never mutated. The instance is a fresh
# git clone with a tag e2e/source pinned at the cloned HEAD, ready for
# scenario branches to be cut from.

# Refuse the sacred specimen as an instance target. Trailing slashes and
# symlinks could otherwise sneak past a literal string comparison.
_spike_is_sacred_path() {
  local p="$1" specimen
  specimen="$HOME/.mykb"
  # Normalize: strip trailing slashes (but keep at least one char).
  while [[ "$p" == */ && "$p" != "/" ]]; do p="${p%/}"; done
  # Direct match.
  [[ "$p" == "$specimen" ]] && return 0
  # Resolve through readlink if the path exists, to catch symlink shenanigans.
  if [[ -e "$p" ]]; then
    local resolved
    resolved="$(readlink -f "$p" 2>/dev/null)" || resolved=""
    [[ "$resolved" == "$specimen" ]] && return 0
  fi
  return 1
}

spike_clone_specimen() {
  if [[ $# -ne 2 ]]; then
    echo "spike_clone_specimen: usage: spike_clone_specimen <specimen> <instance>" >&2
    return 2
  fi
  local specimen="$1" instance="$2"

  if [[ ! -d "$specimen" ]]; then
    echo "spike_clone_specimen: specimen does not exist: $specimen" >&2
    return 1
  fi
  if [[ ! -d "$specimen/.git" ]]; then
    echo "spike_clone_specimen: specimen is not a git repo: $specimen" >&2
    return 1
  fi

  if _spike_is_sacred_path "$instance"; then
    echo "spike_clone_specimen: refuse to clone onto specimen (sacred): $instance" >&2
    return 1
  fi

  if [[ -e "$instance" ]]; then
    echo "spike_clone_specimen: instance already exists: $instance" >&2
    return 1
  fi

  local parent
  parent="$(dirname "$instance")"
  mkdir -p "$parent" || {
    echo "spike_clone_specimen: failed to create parent: $parent" >&2
    return 1
  }

  git clone --quiet "$specimen" "$instance" || {
    echo "spike_clone_specimen: git clone failed" >&2
    return 1
  }

  # Tag the cloned HEAD as the experiment's source pin. Scenario branches
  # cut from here so we can always diff what changed during the experiment.
  ( cd "$instance" && git tag e2e/source HEAD ) || {
    echo "spike_clone_specimen: failed to tag e2e/source" >&2
    return 1
  }
}
