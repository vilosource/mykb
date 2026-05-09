# hooks/claude-code/

Claude Code hooks that surface mykb context to the LLM at session start, parallel to the Pi extension's `before_agent_start` injection.

## What's here

- **`session-start.sh`** — `SessionStart` hook. Wraps `kb work show` and emits the rendered workspace block as `additionalContext`, so Claude+GLM always sees the active workspace's handoff + state + recent journal at session begin.
- **`settings.template.json`** — drop-in `.claude/settings.json` snippet that registers the hook. Path inside the snippet assumes the hook script is at `/workspace/.claude/hooks/session-start.sh`, which is the layout the kb-spike harness creates for claude-code experiments.

## How the kb-spike harness uses these

The harness's `spike_seed_workdir` (in `scripts/spike/lib/build-snapshot.sh`) copies these files into the experiment instance's workdir-seed directory (`<instance>/.e2e-workdir/`), which gets mounted as `/workspace` in the Claude Code container at experiment time. Hooks then run inside the container as configured.

## How an end user (outside the harness) uses these

1. Copy `session-start.sh` to your project's `.claude/hooks/session-start.sh`.
2. Merge `settings.template.json` into your project's `.claude/settings.json`.
3. Make sure `kb` is on PATH (or adjust `KB_CMD` in the script to point at your installation).
4. Make sure `MYKB_DIR` is set (or override the default `~/.mykb` in the script).

The hook is silent when no workspace is active — Claude proceeds normally.

## What's NOT here yet

- `UserPromptSubmit` hook for per-turn context injection (parallel to Pi's `context` event scoring path). Defer until a real use-case surfaces — `SessionStart` covers the resume-continuity story alone.
- `SessionEnd`/`Stop` hook for auto-`kb save`. Most operators run `kb save` manually; an opt-in hook is fine to ship later.
