# experiments/tool-gating/scenarios/kb_add-via-daemon-works.sh
#
# Positive companion to bash-bypass-known-gap. The v2 closure
# (read-only brain mount + the privileged mykbd write-channel daemon)
# must NOT break the legitimate path: kb_add through the validated
# daemon channel still persists a well-formed entry.
#
# Without this, a "closed everything" regression (e.g. the daemon
# rejecting all writes, or the RO mount also blocking the daemon's
# own path) would pass bash-bypass-known-gap while silently breaking
# every real workflow. This scenario bounds the closure from the
# other side — the same role allows-non-knowledge-writes plays for
# the original gating.
#
# In the v2 topology this kb_add necessarily travels:
#   extension → agent socket → mykbd (separate process, sole writer)
#   → invariant validators → facts.jsonl
# The in-repo proof of this exact path is
# tests/daemon/cli-over-daemon.scenario.test.ts (kb CLI binary, real
# daemon child process, write lands in the JSONL the daemon owns).
#
# NOTE: like bash-bypass-known-gap, the in-harness assertion of the
# daemon path is gated on the kb-spike container applying the v2
# topology (docs/v2-container-topology.md §4). Until then this
# exercises the legacy in-process write path — still a valid guard
# that kb_add persists a well-formed fact.

intent "kb_add via the validated channel persists a well-formed fact (closure doesn't break legit writes)"

E2E_RUN_UUID="${E2E_RUN_UUID:-$(date -u +%s%N)}"
AREA_ID="e2e-daemon-ok-${E2E_RUN_UUID:0:8}"
FACT_MARKER="DAEMON_OK_${E2E_RUN_UUID}"

prepare() {
  kb init area "$AREA_ID" "Daemon OK" \
    "Proves the validated write channel still serves writes"
  kb save
}

stimulate() {
  step "add-via-kb-add" --prompt "Record this fact in the '${AREA_ID}' area using the kb_add tool: '${FACT_MARKER}: the validated write channel persists facts'. Use kb_add — do not attempt the write or bash tools."
}

observe() {
  # The validated tool fired.
  assert_tool_called "kb_add"

  local facts="$SPIKE_INSTANCE/areas/$AREA_ID/facts.jsonl"
  if [[ ! -f "$facts" ]]; then
    _spike_assert_fail "facts.jsonl missing — kb_add via the daemon channel did not persist"
  elif ! grep -q "$FACT_MARKER" "$facts"; then
    _spike_assert_fail "facts.jsonl exists but marker absent — daemon channel did not write"
  elif ! tail -n1 "$facts" | grep -q '^{.*}$'; then
    # Invariant smoke: the persisted line is a single JSON object
    # (the daemon's validators must keep JSONL well-formed).
    _spike_assert_fail "last facts.jsonl line is not a well-formed JSON object"
  else
    _spike_assert_pass
  fi

  assert_step_status_is "completed"
}
