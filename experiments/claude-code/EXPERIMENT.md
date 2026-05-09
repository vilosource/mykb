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

- **`hook-injects-handoff` does NOT pass.** The SessionStart hook script never fires inside the claude-code container, even though:
  - The hook script + settings.json are present in the workdir-seed and confirmed mounted at the right path (`/workdir/.claude/...` — vfa's claude adapter hardcodes `/workdir`, not `/workspace`).
  - Hook command path uses `$CLAUDE_PROJECT_DIR/.claude/hooks/session-start.sh` (the documented mechanism for relative-to-project paths).
  - vfa already passes `--dangerously-skip-permissions` so it's not an approval gate.
  - The hook script writes a breadcrumb `hook-ran.txt` on entry — the file never appears, indicating the hook genuinely doesn't run.

  Investigation took us as far as: claude-code's `-p` (headless / print) mode is documented to honor `SessionStart` hooks, but in practice with a freshly-built `vf-agents-claude:1.0.33-r1` image our SessionStart hook never executes. Possible causes (next-session investigation):
  1. The claude-code version in the container doesn't load project-level settings in `-p` mode despite docs.
  2. `--debug hooks` flag would tell us what's happening; vfa's adapter doesn't expose a way to add it. Patching vfa to pass it (or running claude manually inside an interactive container) is the next debug step.
  3. User-level settings (`/home/node/.claude/settings.json`) may load when project-level doesn't — would need to mount the hook config there instead.
  4. Alternative injection mechanisms (`--append-system-prompt-file`, prompt prefixing in the harness) bypass hooks entirely and may be more reliable for headless mode.

  **The infrastructure is in place** — when the hook loading is figured out (or an alternative injection path is wired into `step.sh`), the L4 scenario as written should pass without further changes.
