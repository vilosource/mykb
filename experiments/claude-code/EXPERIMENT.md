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

### What doesn't yet work (⏳)

- **`hook-injects-handoff` does NOT pass.** Definitively diagnosed end of this session. The chain to making the hook fire required several discoveries:
  1. `claude -p` does NOT load project-level `.claude/settings.json` by default — needs `--setting-sources user,project,local` explicitly. **Patched vfa's claude adapter** in `internal/adapter/claude.go` to pass it; rebuilt + reinstalled.
  2. vfa's claude adapter mounts the workdir at `/workdir`, not the profile's declared `mount_path`. **Aligned `mount_path: /workdir` in the profile** so docker exec's cwd matches where the workdir is bound — otherwise claude looks for `.claude/settings.json` in an empty path.
  3. After (1) and (2): the hook **does fire** (verified via breadcrumb file + `--include-hook-events` stream output), and emits well-formed JSON with `additionalContext` containing the marker. **But the LLM never sees that context.**
  4. **Root cause:** `additionalContext` from `SessionStart` hooks **is not injected into the LLM in `-p` mode**. Confirmed via Claude Code documentation lookup: this field is for interactive sessions only. Print mode strips the interactive context-injection pipeline; the hook's output is processed but never reaches the model.

  **The documented path forward for headless context injection is `--append-system-prompt-file`.** That requires another vfa adapter change — accept a per-experiment path and pass it through. Out of scope for this commit; logged as the v2 follow-up.

  **The infrastructure that IS in place** — the `--runtime claude-code` flag, profile generation, workdir-seed mechanism, hook scripts (which fire correctly), and vfa adapter patches for `--setting-sources` + cwd alignment — all become useful once the file-based injection path is added. No throwaway work.
