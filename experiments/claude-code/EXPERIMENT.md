# Experiment: claude-code

**Source spec:** `hooks/claude-code/README.md`, `scripts/spike/lib/profile.sh` (claude-code branch).
**Implementation:** `hooks/claude-code/session-start.sh` + `hooks/claude-code/settings.template.json` (the kb integration); `scripts/spike/lib/{profile,step,build-snapshot,meta}.sh` (the harness's claude-code runtime support).

## Intent

Validates the Claude Code + z.ai GLM integration with mykb. The Pi runtime ships an in-process extension that auto-injects workspace context via `before_agent_start` and `context` events. Claude Code has no equivalent extension surface, but it does expose a hooks system in `.claude/settings.json` that can shell out to the kb CLI and emit `additionalContext` JSON for the LLM.

This experiment proves:
1. The harness can drive Claude Code (provider `zai-glm`) end-to-end alongside Pi.
2. The mykb session-start hook surfaces the active workspace's handoff/state/journal to Claude+GLM at session begin, without the operator or LLM having to ask.

## Behavior matrix

| Stimulus | Expected behavior | Scenario |
|----------|-------------------|----------|
| Claude Code container starts; nothing kb-related in user prompt | LLM responds normally — pure smoke check that the harness can fire claude-code at all | `bare-runs` |
| Workspace has a handoff with a unique marker; SessionStart hook is configured | LLM cites the marker without being asked about kb | `hook-injects-handoff` |

## Notes

- **Provider:** `zai-glm` (Claude Code with z.ai's GLM-4.7 backend). Set automatically by the harness when the experiment instance's runtime is `claude-code`.
- **Mounts inside the container:**
  - `/home/node/.mykb` → the brain instance (cloned from `~/.mykb`)
  - `/opt/mykb-cli` → the captured CLI (so hooks can `node /opt/mykb-cli/cli.js work show`)
  - `/workspace` → the workdir-seed with `.claude/settings.json` + `.claude/hooks/`
- **The hook script silently no-ops when no workspace is active**, so `bare-runs` doesn't need any kb state — it just confirms the runtime fires.
- **Marker discipline:** same as the other matrices. `E2E_RUN_UUID` per run, embedded in the handoff text, asserted via `assert_llm_contains`.

## Status

### What works (✅)

- **`bare-runs` passes** — harness drives Claude Code via `zai-glm` end-to-end: profile generation (with `workdir.type: persistent` pointing at the per-experiment seed dir), container start, prompt, response capture, runtime detection in `step.sh` for the right `--provider`. The full claude-code lane through the harness is operational.
- **kb-spike runtime support is shipped:** `kb-spike new --runtime claude-code` works; meta records the runtime; `step.sh` routes `--provider zai-glm` automatically; `spike_seed_workdir` populates the workdir-seed from `hooks/claude-code/`. All wired at the unit-test level (bats) and verified end-to-end.

### Diagnostic chain (kept for the post-mortem)

Reaching `pass=true` on `hook-injects-handoff` required four sequential discoveries; each one closed a layer:

1. **`claude -p` doesn't load project-level `.claude/settings.json` by default.** Needs `--setting-sources user,project,local` explicitly. Patched in vfa's claude adapter (`internal/adapter/claude.go`).
2. **vfa hardcodes the workdir mount at `/workdir`**, regardless of the profile's `mount_path`. Setting `mount_path` to anything else (we had `/workspace`) makes docker exec's cwd diverge from where the workdir is bound, and claude looks for settings.json in the wrong place. Aligned `mount_path: /workdir` in profile.sh's claude-code branch.
3. After (1) + (2): the SessionStart hook **fires** — verified via breadcrumb file and `--include-hook-events` showing `hook_started` + `hook_response` with well-formed JSON containing the marker.
4. **But `additionalContext` from `SessionStart` hooks is interactive-only.** It is silently dropped in `-p` mode. The documented path for headless injection is `--append-system-prompt-file`.

### How `hook-injects-handoff` passes today

After (1)–(4), the contract was reconfigured:

- The harness writes the workspace block to `<instance>/.e2e-workdir/.kb-context.md` via the new `spike_export_context` scenario helper (defined in `step.sh`). Pi runtime experiments don't call this; their auto-injection happens via session hooks.
- vfa's claude adapter unconditionally passes `--append-system-prompt-file /workdir/.kb-context.md` to claude. `spike_seed_workdir` always creates an empty `.kb-context.md` so the file exists; scenarios overwrite it with content via `spike_export_context`.
- claude prepends the file's contents to the system prompt; the LLM sees the kb context from the first turn, regardless of `-p` mode.

The `SessionStart` hook script + `.claude/settings.json` are still installed in the workdir-seed for completeness, but they're no longer load-bearing for the L4 contract — they would matter for interactive sessions only. Treat them as documentation of the discovery rather than the production path.
