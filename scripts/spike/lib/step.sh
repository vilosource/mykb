# scripts/spike/lib/step.sh
#
# Scenario-facing helpers. Sourced by the orchestrator into the scenario
# environment so scripts under experiments/<feature>/scenarios/ can call
# `intent`, `step`, and `kb` directly.
#
# Required environment (set by the orchestrator before sourcing scenario):
#   SPIKE_INSTANCE  — brain instance path
#   SPIKE_EXP_ID    — experiment id (used to derive vfa profile name)
#   SPIKE_SCENARIO  — current scenario name (used for step file paths)
#   SPIKE_STEP_NUM  — running counter (initialized to 0)

# intent — record a one-line description of the scenario. Cosmetic; used
# in result files and `kb-spike show` output.
intent() {
  if [[ $# -ne 1 ]]; then
    echo "intent: usage: intent \"<one-line description>\"" >&2
    return 2
  fi
  export SPIKE_SCENARIO_INTENT="$1"
}

# step <name> --prompt "..."
#
# Run vfa against the per-experiment profile, capture the JSON to a
# per-step file inside the instance, commit. Updates SPIKE_LAST_STEP_FILE
# and SPIKE_STEP_NUM so assertions and subsequent steps know what just
# happened.
step() {
  local name="$1" prompt=""
  shift || {
    echo "step: usage: step <name> --prompt \"...\"" >&2
    return 2
  }
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --prompt) prompt="$2"; shift 2;;
      *)
        echo "step: unknown argument: $1" >&2
        return 2;;
    esac
  done
  if [[ -z "$prompt" ]]; then
    echo "step: --prompt is required" >&2
    return 2
  fi

  if [[ -z "${SPIKE_INSTANCE:-}" ]]; then
    echo "step: SPIKE_INSTANCE is unset (orchestrator should set it)" >&2
    return 1
  fi
  if [[ -z "${SPIKE_EXP_ID:-}" ]]; then
    echo "step: SPIKE_EXP_ID is unset" >&2
    return 1
  fi
  if [[ -z "${SPIKE_SCENARIO:-}" ]]; then
    echo "step: SPIKE_SCENARIO is unset" >&2
    return 1
  fi

  SPIKE_STEP_NUM=$(( ${SPIKE_STEP_NUM:-0} + 1 ))
  export SPIKE_STEP_NUM

  local steps_dir="$SPIKE_INSTANCE/.e2e-steps/$SPIKE_SCENARIO"
  mkdir -p "$steps_dir"
  local step_file
  step_file="$(printf '%s/%03d-%s.json' "$steps_dir" "$SPIKE_STEP_NUM" "$name")"

  # Build the vfa argv.
  #
  # Provider routing depends on the experiment's runtime:
  #   pi          -> --provider pi          (Pi runtime, kb extension)
  #   claude-code -> --provider zai-glm     (Claude Code via z.ai's GLM)
  #
  # SPIKE_DISABLE_TOOLS=1 (set by scoring-isolation scenarios) translates
  # to '--env MYKB_DISABLE_TOOLS=1' regardless of runtime; the kb
  # extension reads it to skip registerTools.
  #
  # SPIKE_SCENARIO_SESSION_ID is a per-scenario stable session id derived
  # from the experiment id + scenario name. When set, every step within
  # one scenario reuses it via --env KB_SESSION_ID=<id>, allowing mykb's
  # extension state (signals, loaded areas, turn count) to persist across
  # the separate Pi containers that each `step` spins up. Different
  # scenarios get different ids so they never share state. See
  # src/extension/state.ts (file-backed SessionState) and
  # experiments/area-scoring/scenarios/scoring-isolated.sh.
  local provider="pi"
  case "${SPIKE_RUNTIME:-pi}" in
    pi)          provider="pi" ;;
    claude-code) provider="zai-glm" ;;
    *) echo "step: unsupported SPIKE_RUNTIME: ${SPIKE_RUNTIME}" >&2; return 1 ;;
  esac

  local -a vfa_args=(run --provider "$provider" --profile "e2e-${SPIKE_EXP_ID}")
  if [[ "${SPIKE_DISABLE_TOOLS:-}" == "1" ]]; then
    vfa_args+=(--env "MYKB_DISABLE_TOOLS=1")
  fi
  if [[ -n "${SPIKE_SCENARIO_SESSION_ID:-}" ]]; then
    vfa_args+=(--env "KB_SESSION_ID=${SPIKE_SCENARIO_SESSION_ID}")
  fi
  vfa_args+=(--prompt "$prompt")

  # Run vfa. Capture stdout (JSON) to the step file; stderr goes to the
  # operator. Use `|| rc=$?` instead of relying on $? — the orchestrator
  # runs with `set -e`, so a non-zero vfa exit would otherwise kill the
  # whole scenario before we can record what happened. We want vfa
  # failures to surface as a failed step (via assertions), not as a
  # crashed harness.
  local rc=0
  vfa "${vfa_args[@]}" > "$step_file" || rc=$?

  export SPIKE_LAST_STEP_FILE="$step_file"

  # Commit the step (and any side effects from prepare/stimulate that
  # haven't been committed yet — kb wrapper handles its own commits but
  # there may be vfa-induced state changes inside the brain).
  (
    cd "$SPIKE_INSTANCE"
    git add -A >/dev/null 2>&1 || true
    git commit -q -m "step(${SPIKE_SCENARIO}/${SPIKE_STEP_NUM}): ${name}" --allow-empty
  )

  return $rc
}

# spike_export_context
#
# Headless-Claude-Code companion to Pi's auto-injection. Pi's session
# hook injects the workspace state into the system prompt automatically;
# Claude Code's `-p` mode does not honor `additionalContext` from
# SessionStart hooks (interactive-only — confirmed by Anthropic docs).
# The documented headless path is `--append-system-prompt-file`, which
# vfa's claude adapter passes pointing at /workdir/.kb-context.md.
#
# Scenarios call this in prepare() (after writing handoff/journal/state
# via the `kb` wrapper) to materialize that file. Pi scenarios don't
# need to call it; the function is a no-op when the workdir-seed
# doesn't exist.
spike_export_context() {
  if [[ -z "${SPIKE_INSTANCE:-}" ]]; then
    echo "spike_export_context: SPIKE_INSTANCE is unset" >&2
    return 1
  fi
  local seed="$SPIKE_INSTANCE/.e2e-workdir"
  [[ -d "$seed" ]] || return 0   # not a claude-code experiment; nothing to do.

  local cli="$SPIKE_INSTANCE/.e2e-build/cli/cli.js"
  if [[ ! -f "$cli" ]]; then
    echo "spike_export_context: captured cli missing at $cli" >&2
    return 1
  fi
  # `kb work show` against the captured cli — wrap with mykb tags so the
  # LLM can recognize the surface (parallels Pi's <mykb-workspace>).
  local body
  if body="$( MYKB_DIR="$SPIKE_INSTANCE" node "$cli" work show 2>/dev/null )"; then
    {
      echo "<mykb-workspace>"
      echo "$body"
      echo "</mykb-workspace>"
    } > "$seed/.kb-context.md"
  else
    : > "$seed/.kb-context.md"
  fi
}

# kb <args>...
#
# Wrapper around the captured cli. Scenarios use this to drive workspace
# setup or knowledge mutations during prepare/stimulate. Auto-commits any
# resulting working-tree diff (kb's own `kb save` already commits, so we
# skip when the tree is clean).
kb() {
  if [[ -z "${SPIKE_INSTANCE:-}" ]]; then
    echo "kb: SPIKE_INSTANCE is unset" >&2
    return 1
  fi
  local cli="$SPIKE_INSTANCE/.e2e-build/cli/cli.js"
  if [[ ! -f "$cli" ]]; then
    echo "kb: captured cli not found at $cli" >&2
    return 1
  fi
  # See step() — `set -e` in the orchestrator would otherwise kill us on
  # any non-zero exit from the captured cli.
  local rc=0
  MYKB_DIR="$SPIKE_INSTANCE" node "$cli" "$@" || rc=$?

  (
    cd "$SPIKE_INSTANCE"
    if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null \
       || [[ -n "$(git ls-files --others --exclude-standard)" ]]; then
      git add -A
      git commit -q -m "kb $*"
    fi
  )

  return $rc
}
