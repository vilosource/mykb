# Session Isolation — Design

## Problem

`~/.mykb/workspaces/.active` is **global state**. Every process using the same brain
reads and writes a single file to track which workspace is currently active. When
multiple sessions run simultaneously — two terminal windows with `kb-pi`, a host
Claude alongside a containerized Pi, etc. — they corrupt each other silently:

- Session A: `kb work start plandent` → writes `"plandent"` to `.active`
- Session B: `kb work start mykb` → overwrites `.active` with `"mykb"`
- Session A: `kb work journal "..."` → now journals to `mykb` instead of `plandent`

No error. No warning. Wrong workspace, silently.

This affects every workspace-scoped command: `kb work journal`, `kb work state`,
`kb work show`, `kb wsa add`, and any future workspace-aware features.

## Context: How Sessions Are Launched

There are four launch variants in use:

| Alias | Description |
|---|---|
| `kb-pi` | Host Pi with kb (no container) |
| `kb-claude` | Host Claude Code with kb (no container) |
| `kb-cpi` | Containerized Pi via vf-agents (`kb` profile) |
| `kb-cclaude` | Containerized Claude Code via vf-agents (`kb` profile) |

In all four cases, the brain at `~/.mykb` is accessed — either directly on the host
or via a bind mount (`~/.mykb → /home/node/.mykb`) in the container. Multiple
simultaneous sessions share the same brain directory, hence the same `.active` file.

### Why a Simple `MYKB_WORKSPACE` Env Var Isn't Enough

An obvious first fix: inject `MYKB_WORKSPACE=<id>` at launch time and have
`getActiveWorkspaceId()` check it before `.active`. This works if the workspace is
known at launch time.

But the actual usage pattern is:

1. Launch `kb-pi` or `kb-claude` — no workspace selected yet
2. Pi/Claude runs `kb work start plandent` interactively during the session
3. The workspace is now set for this session

`kb work start` calls `setActiveWorkspaceId()` which writes `.active`. A static env
var set at launch can't be updated by a child process (`kb`) to affect its parent
shell or sibling processes. The env var approach only works as an explicit override,
not as the primary isolation mechanism.

## Solution: `KB_SESSION_ID`

Each launch function generates a **unique session ID** (UUID) at startup and passes
it into the runtime as the `KB_SESSION_ID` environment variable. mykb uses this ID
to derive a **per-session state file** in the OS temp directory.

```
<tmpdir>/.mykb-session-<KB_SESSION_ID>
```

Where `<tmpdir>` is `os.tmpdir()` in TypeScript / `/tmp` on Linux.

This file contains only the active workspace ID for that session. It is:
- **Per-process**: generated fresh on each alias invocation
- **Ephemeral**: lives in `/tmp/`, cleaned up by the OS
- **Isolated**: unique ID means zero collision between concurrent sessions
- **Uniform**: identical mechanism for host and containerized launches

## Priority Chain in `getActiveWorkspaceId()`

```
1. MYKB_WORKSPACE env var
   └─ Explicit override. For scripted/one-shot use where the workspace
      is known at call time. Highest priority, bypasses all files.

2. /tmp/.mykb-session-<KB_SESSION_ID>
   └─ Per-session isolation. Set by kb work start during the session.
      Used when KB_SESSION_ID is in the environment.

3. ~/.mykb/workspaces/.active
   └─ Global fallback. Used when neither env var above is set.
      Single-instance CLI use on the host, no alias involved.
```

`setActiveWorkspaceId(id)` mirrors this: writes to the session file when
`KB_SESSION_ID` is set, otherwise writes to `.active`.

`clearActiveWorkspaceId()` mirrors this too: removes the session file when
`KB_SESSION_ID` is set, otherwise removes `.active`.

## Shell Functions

All four functions follow the same pattern: generate a UUID, pass it as
`KB_SESSION_ID` to the runtime.

```bash
# Host Pi with kb
kb-pi() {
  local sid
  sid=$(uuidgen)
  KB_SESSION_ID="$sid" pi "$@"
}

# Host Claude Code with kb
kb-claude() {
  local sid
  sid=$(uuidgen)
  KB_SESSION_ID="$sid" claude "$@"
}

# Containerized Pi via vf-agents
kb-cpi() {
  local sid
  sid=$(uuidgen)
  vfa run --provider pi --profile kb --access full \
    --workdir "${1:-.}" --interactive \
    --env "KB_SESSION_ID=$sid"
}

# Containerized Claude Code via vf-agents
kb-cclaude() {
  local sid
  sid=$(uuidgen)
  vfa run --provider claude-anthropic --profile kb --access full \
    --workdir "${1:-.}" --interactive \
    --env "KB_SESSION_ID=$sid"
}
```

For host launches, `KB_SESSION_ID` is set as a prefixed env var for the duration
of that process. For containerized launches, it is passed into the container via
`vfa run --env`, which requires a new `--env` flag on `vfa run` (see below).

## Scenarios

### Two simultaneous host Pi sessions

```
Terminal 1: kb-pi ~/GitHub/plandent
  → KB_SESSION_ID=a1b2c3d4
  → kb work start plandent → writes /tmp/.mykb-session-a1b2c3d4

Terminal 2: kb-pi ~/GitHub/mykb
  → KB_SESSION_ID=e5f6g7h8
  → kb work start mykb → writes /tmp/.mykb-session-e5f6g7h8

Terminal 1: kb work journal "..."  → reads /tmp/.mykb-session-a1b2c3d4 = "plandent" ✓
Terminal 2: kb work journal "..."  → reads /tmp/.mykb-session-e5f6g7h8 = "mykb"     ✓
```

### Host session + containerized session simultaneously

```
Host:      kb-claude ~/GitHub/stark
  → KB_SESSION_ID=aaaa1111
  → kb work start stark → writes /tmp/.mykb-session-aaaa1111

Container: kb-cpi ~/GitHub/plandent
  → KB_SESSION_ID=bbbb2222 (injected into container env)
  → Container /tmp/ is separate from host /tmp/
  → kb work start plandent → writes /tmp/.mykb-session-bbbb2222 (inside container)

No conflict. ✓
```

### Plain `kb` on host (no alias, no session ID)

```
$ kb work start mykb
  → KB_SESSION_ID not set
  → falls through to ~/.mykb/workspaces/.active
  → writes "mykb" to .active as today ✓
```

### Scripted one-shot use

```bash
MYKB_WORKSPACE=plandent kb work journal "deployed to staging"
  → MYKB_WORKSPACE set → used directly, no file read ✓
```

## Changes Required

### 1. mykb — `src/core/workspace.ts`

Add a private helper for session file path:
```typescript
import os from 'node:os';

private sessionFile(): string | null {
  const sessionId = process.env.KB_SESSION_ID?.trim();
  if (!sessionId) return null;
  return path.join(os.tmpdir(), `.mykb-session-${sessionId}`);
}
```

`getActiveWorkspaceId()`:
```typescript
getActiveWorkspaceId(): string | null {
  // Tier 1: explicit override
  const explicit = process.env.MYKB_WORKSPACE;
  if (explicit?.trim()) return explicit.trim();

  // Tier 2: per-session isolation
  const sf = this.sessionFile();
  if (sf) {
    if (fs.existsSync(sf)) {
      return fs.readFileSync(sf, 'utf-8').trim() || null;
    }
    return null; // session active but no workspace set yet
  }

  // Tier 3: global fallback
  const file = this.activeFile();
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, 'utf-8').trim() || null;
}
```

`setActiveWorkspaceId(id)`:
```typescript
setActiveWorkspaceId(id: string): void {
  const sf = this.sessionFile();
  if (sf) {
    fs.writeFileSync(sf, id + '\n');
    return;
  }
  this.ensureDir(this.workspacesDir);
  fs.writeFileSync(this.activeFile(), id + '\n');
}
```

`clearActiveWorkspaceId()`:
```typescript
clearActiveWorkspaceId(): void {
  const sf = this.sessionFile();
  if (sf) {
    if (fs.existsSync(sf)) fs.unlinkSync(sf);
    return;
  }
  const file = this.activeFile();
  if (fs.existsSync(file)) fs.unlinkSync(file);
}
```

### 2. vf-agents — `--env KEY=VALUE` flag on `vfa run`

The containerized launch functions need to inject `KB_SESSION_ID` into the container
at runtime. The profile `env:` field is static YAML and cannot carry a dynamically
generated value. A new `--env KEY=VALUE` flag on `vfa run` (and `vfa session start`)
passes ad-hoc env vars directly into the container.

Affected files:
- `cmd/run.go` — add `--env` flag, parse into `[]domain.EnvVar`
- `cmd/session.go` — same
- `internal/orchestrator/run.go` — add `AdHocEnvVars` to `RunOpts`, merge into `allEnvVars`

### 3. bashrc — Replace existing aliases

Replace the existing `kb-claude` and `kb-pi` aliases with the four functions above.
The existing `kb-claude` and `kb-pi` (containerized) become `kb-cclaude` and
`kb-cpi`. New `kb-pi` and `kb-claude` are host launches.

## Backward Compatibility

- Plain `kb` CLI on the host: unaffected — `KB_SESSION_ID` not set, `.active` used
- Existing `kb-claude` / `kb-pi` aliases: replaced, not silently broken
- `MYKB_WORKSPACE` override: still works, highest priority
- Brain git history, `workspace.json`, `journal.jsonl`: untouched

## Non-Goals

- Cleaning up stale `/tmp/.mykb-session-*` files — the OS handles this; they are
  small text files and `/tmp/` is cleared on reboot
- Persisting the session workspace across process restarts — the session file is
  intentionally ephemeral. A new launch = a new session ID = a fresh start
- Multi-user isolation — the brain is a personal tool; user-level isolation is
  out of scope
