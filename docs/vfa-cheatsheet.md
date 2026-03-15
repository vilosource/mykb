# vfa Cheat Sheet for mykb Development

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

In a profile YAML, mount host directories into Pi's extension path:

```yaml
plugins:
  pi:
    - source: /home/jasonvi/GitHub/mykb/spikes/active-spike
      mount: /home/node/.pi/agent/extensions/mykb-spike
```

The container user is `node` (UID 1000). Pi extensions auto-discover from `~/.pi/agent/extensions/`.

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
