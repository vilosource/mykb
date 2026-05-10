#!/usr/bin/env bash
#
# kb session-start hook for Claude Code.
#
# Configured in .claude/settings.json under hooks.SessionStart. Fires
# at session begin/resume; output's `additionalContext` field is
# prepended to Claude's system context for the entire session.
#
# Output: a JSON object emitted to stdout. Claude Code parses it and,
# on exit code 0, prepends `additionalContext` to the LLM's view.
#
# This hook surfaces the active workspace's resume context (handoff +
# state + recent journal) — equivalent to what Pi's
# `before_agent_start` does via system-prompt augmentation. Without
# this hook, Claude+GLM has only the CLAUDE.md guidance and would have
# to call `kb work show` itself; with it, the context is always there.

set -euo pipefail

# Diagnostic breadcrumb — write a file inside the project's .claude/
# so the operator can verify the hook actually fired (the hook output
# disappears into Claude's internal context). $CLAUDE_PROJECT_DIR is
# set by Claude Code to the project root (e.g. /workdir under vfa).
# Persistent workdir means this survives the container.
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-/workdir}"
mkdir -p "$PROJECT_DIR/.claude"
{
  echo "session-start.sh fired at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "MYKB_DIR=${MYKB_DIR:-unset}"
  echo "CLAUDE_PROJECT_DIR=${CLAUDE_PROJECT_DIR:-unset}"
  echo "PWD=$PWD"
} > "$PROJECT_DIR/.claude/hook-ran.txt" 2>&1

# Discard the stdin JSON event payload — we don't need it for this
# hook, but consuming it is good practice (some shells inherit the
# closed-pipe state).
cat >/dev/null

# `kb` is mounted at /opt/mykb-cli inside the container; MYKB_DIR
# points at the brain mount.
KB_CMD=(node /opt/mykb-cli/cli.js)
export MYKB_DIR="${MYKB_DIR:-/home/node/.mykb}"

# Pull the workspace block. `kb work show` returns the active
# workspace's rendered markdown when one is active, or a non-zero
# exit and an error message when there isn't. We want the no-active
# case to be silent (no injection).
ws_block=""
if ws_block="$( "${KB_CMD[@]}" work show 2>/dev/null )"; then
  :
else
  ws_block=""
fi

if [[ -z "$ws_block" ]]; then
  # No active workspace -> no context to inject. Emit empty JSON so
  # Claude proceeds normally.
  printf '{"hookSpecificOutput":{"hookEventName":"SessionStart"}}\n'
  exit 0
fi

# Wrap the workspace block with mykb-style delimiters so the LLM
# can recognize the surface (parallels Pi's <mykb-workspace> tag).
context="<mykb-workspace>
${ws_block}
</mykb-workspace>"

jq -n --arg ctx "$context" \
  '{additionalContext: $ctx, hookSpecificOutput: {hookEventName: "SessionStart"}}'
