# scripts/spike/lib/meta.sh
#
# Read/write the per-experiment metadata file <instance>/.e2e-meta.json.
#
# Provides:
#   spike_write_meta <instance>    (reads SPIKE_* env vars)
#   spike_read_meta  <instance> <field>
#
# .e2e-meta.json captures everything an operator needs to know about an
# experiment instance after the fact: which experiment it belongs to,
# what we cloned from, what build is captured (build-meta.json holds the
# build commit), the vfa profile path, and the original intent.

# Runtimes the harness knows how to drive. Pi has the kb extension
# (auto-injection via session/context hooks); claude-code has hooks
# configured in .claude/settings.json that wrap the kb CLI.
_SPIKE_SUPPORTED_RUNTIMES=("pi" "claude-code")

_spike_runtime_supported() {
  local r="$1" sup
  for sup in "${_SPIKE_SUPPORTED_RUNTIMES[@]}"; do
    [[ "$r" == "$sup" ]] && return 0
  done
  return 1
}

spike_write_meta() {
  if [[ $# -ne 1 ]]; then
    echo "spike_write_meta: usage: spike_write_meta <instance>" >&2
    return 2
  fi
  local instance="$1"
  if [[ ! -d "$instance" ]]; then
    echo "spike_write_meta: instance does not exist: $instance" >&2
    return 1
  fi

  local var
  for var in SPIKE_EXP_ID SPIKE_EXPERIMENT SPIKE_INTENT SPIKE_SPECIMEN \
             SPIKE_SOURCE_COMMIT SPIKE_PROFILE_PATH; do
    if [[ -z "${!var:-}" ]]; then
      echo "spike_write_meta: required env var $var is unset or empty" >&2
      return 1
    fi
  done

  # Runtime defaults to pi for backward compatibility with the v1
  # matrices. Validate against the supported set so we fail fast on
  # typos rather than emitting an unrunnable profile downstream.
  local runtime="${SPIKE_RUNTIME:-pi}"
  if ! _spike_runtime_supported "$runtime"; then
    echo "spike_write_meta: unsupported runtime: $runtime (supported: ${_SPIKE_SUPPORTED_RUNTIMES[*]})" >&2
    return 1
  fi

  jq -n \
    --arg exp_id "$SPIKE_EXP_ID" \
    --arg experiment "$SPIKE_EXPERIMENT" \
    --arg intent "$SPIKE_INTENT" \
    --arg specimen "$SPIKE_SPECIMEN" \
    --arg source_commit "$SPIKE_SOURCE_COMMIT" \
    --arg profile_path "$SPIKE_PROFILE_PATH" \
    --arg runtime "$runtime" \
    --arg created_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    '{
      exp_id: $exp_id,
      experiment: $experiment,
      intent: $intent,
      specimen: $specimen,
      source_commit: $source_commit,
      profile_path: $profile_path,
      runtime: $runtime,
      created_at: $created_at
    }' > "$instance/.e2e-meta.json"
}

spike_read_meta() {
  if [[ $# -ne 2 ]]; then
    echo "spike_read_meta: usage: spike_read_meta <instance> <field>" >&2
    return 2
  fi
  local instance="$1" field="$2"
  local meta="$instance/.e2e-meta.json"
  if [[ ! -f "$meta" ]]; then
    echo "spike_read_meta: meta file not found: $meta" >&2
    return 1
  fi
  local val
  val="$(jq -r --arg f "$field" '.[$f] // ""' "$meta")"
  printf '%s' "$val"
}
