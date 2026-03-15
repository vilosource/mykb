# vfa Cheat Sheet for mykb Development

## What is vfa?

`vfa` (vf-agents) is the **only way we run Pi**. Pi is not installed locally — it runs inside Docker containers managed by vfa. Every `vfa run` or `vfa session start` spins up a fresh Pi container, mounts credentials and extensions, executes the prompt, and returns a normalized JSON result.

The flow:
```
You → vfa CLI → Docker container (Pi + extensions) → LLM provider → result JSON
```

For mykb development, vfa is how we test Pi extensions. We create a **run profile** that mounts our extension code into the container's Pi extensions directory. Pi auto-discovers and loads it.

## When to use `run` vs `session`

| Use | When |
|-----|------|
| `vfa run` | Single-shot test — one prompt, one response, container destroyed. Use for spike testing and quick validation. |
| `vfa session start/send` | Multi-turn test — container stays alive, conversation context preserved across turns. Use when testing context persistence, multi-step interactions, or extension state that accumulates over turns. |

## Quick Reference

```bash
# List what's available
vfa providers          # provider configs (pi, zai-glm, claude-anthropic, gemini)
vfa runtimes           # runtimes (pi, claude-code, gemini-cli)
vfa profiles           # run profiles (mykb-spike, ...)

# One-shot headless run
vfa run --provider pi --prompt "Say hello"
vfa run --provider pi --profile mykb-spike --prompt "Test the extension"
vfa run --provider pi --workspace ./src --prompt "Review this code"

# Multi-turn sessions
vfa session start --provider pi --prompt "Let's build something"
vfa session send --prompt "Now add tests"
vfa session send --prompt "Run them"
vfa session close

# Session management
vfa session list        # list active sessions (* = active)
vfa session which       # show current active session
vfa session switch ID   # switch to a different session
vfa session attach      # interactive TTY into active session
vfa session prune       # kill all sessions

# Inspect results
vfa runs                # list recent runs
vfa result RUN_ID       # show result JSON
vfa logs RUN_ID         # show stdout

# Set default provider
vfa use pi              # now `vfa run --prompt "..."` uses pi
vfa which               # show current default
```

## mykb Spike Testing

```bash
# Profile: ~/.vf-agents/profiles/mykb-spike.yaml
# Mounts: spikes/active-spike/ → /home/node/.pi/agent/extensions/mykb-spike/

# Switch active spike (symlink)
cd ~/GitHub/mykb/spikes
ln -sfn 01-context-injection active-spike   # or 02-tool-gating, 03-sqlite-in-pi

# Run spike test
vfa run --provider pi --profile mykb-spike --prompt "your test prompt"
```

## Provider Configs

| ID | Runtime | Description |
|----|---------|-------------|
| `pi` | pi | Pi agent via z.ai (config-dir auth, GLM model) |
| `zai-glm` | claude-code | GLM-4.7 via z.ai (cheap) |
| `claude-anthropic` | claude-code | Claude via Anthropic (subscription) |
| `gemini` | gemini-cli | Gemini CLI via Google AI |

Provider configs live at `~/.vf-agents/providers/*.yaml`.

## Key Concepts

- **Provider Config** = runtime + provider + credentials (like a DB connection string)
- **Run Profile** = reusable execution settings (workspace, timeout, plugins, instructions)
- **Harness** = runtime + profile (the complete scaffold wrapping the LLM)
- **Plugins** = volume mounts into the container, keyed by runtime ID

## Profile Plugin Mounts (Pi Extensions)

This is how mykb extension code gets into the Pi container. The profile YAML uses `plugins` to volume-mount a host directory into Pi's extensions path inside the container:

```yaml
# ~/.vf-agents/profiles/mykb-spike.yaml
plugins:
  pi:
    - source: /home/jasonvi/GitHub/mykb/spikes/active-spike    # host path
      mount: /home/node/.pi/agent/extensions/mykb-spike         # container path
```

**How it works:**
1. vfa reads the profile and creates a Docker volume mount: `host:source → container:mount`
2. The container starts with Pi installed at `/home/node/.pi/agent/`
3. Pi scans `~/.pi/agent/extensions/` on startup and auto-discovers any `index.ts` files
4. Your extension loads in-process — no registration, no configuration

**The container user is `node` (UID 1000).** Extensions path inside the container is `/home/node/.pi/agent/extensions/`.

**If the extension needs npm dependencies** (e.g., `better-sqlite3`), install them on the host first (`npm install` in the spike directory). The `node_modules/` gets mounted into the container along with the code. Host and container must share the same Node.js major version (both Node.js 20) for native modules to work.

## Pi Container Details

- Image: `ghcr.io/vilosource/vf-agents-pi:latest`
- Base: `node:20-bookworm-slim`
- Pi version: 0.58.1 (`@mariozechner/pi-coding-agent`)
- User: `node` (UID 1000)
- Config path: `/home/node/.pi/agent/`
- Auth: `auth.json` mounted read-only from host `~/.pi/agent/auth.json`
- Headless flag: `-p`
- JSON output: `--mode json`
- Model selection: `--model <model>` CLI flag
- Instruction file: `AGENTS.md`
- Resume flag: `--continue` (for multi-turn sessions)
