# Session Isolation — Implementation Plan

**Design:** [`session-isolation-DESIGN.md`](session-isolation-DESIGN.md)

## Overview

Three repositories change. Each is independent and can be implemented and tested
in isolation. The order below is the recommended sequence: mykb first (the core
fix), vf-agents second (enables containerized use), bashrc last (wires it all up).

---

## Phase 1: mykb — Session-Isolated Workspace Tracking

**Scope:** `src/core/workspace.ts` only. Three method changes.
**Principle:** No other file should change — all `.active` access is already
encapsulated behind `FileSystemWorkspaceStorage` (Guardrail 4).

### Step 1.1 — RED: Tests for session-isolated workspace tracking

Add to `src/core/workspace.test.ts` (or equivalent test file):

```
- getActiveWorkspaceId() with KB_SESSION_ID set + session file exists → returns file content
- getActiveWorkspaceId() with KB_SESSION_ID set + no session file → returns null
- getActiveWorkspaceId() with KB_SESSION_ID not set + .active exists → returns .active content
- getActiveWorkspaceId() with MYKB_WORKSPACE set → returns env var value (ignores session file and .active)
- setActiveWorkspaceId() with KB_SESSION_ID set → writes to /tmp/.mykb-session-<id>
- setActiveWorkspaceId() with KB_SESSION_ID not set → writes to .active
- clearActiveWorkspaceId() with KB_SESSION_ID set → removes session file
- clearActiveWorkspaceId() with KB_SESSION_ID not set → removes .active
```

Test isolation: set/unset `process.env.KB_SESSION_ID` and `process.env.MYKB_WORKSPACE`
in `beforeEach`/`afterEach`. Use a random suffix for the session file path to avoid
test-to-test collision (`/tmp/.mykb-session-test-<randomId>`).

Commit: `test: KB_SESSION_ID session isolation for workspace tracking`

### Step 1.2 — GREEN: Implement in `workspace.ts`

Update three methods in `FileSystemWorkspaceStorage`:

**`getActiveWorkspaceId()`** — priority chain: `MYKB_WORKSPACE` → session file → `.active`

**`setActiveWorkspaceId(id)`** — writes session file when `KB_SESSION_ID` set, else `.active`

**`clearActiveWorkspaceId()`** — removes session file when `KB_SESSION_ID` set, else `.active`

See `session-isolation-DESIGN.md` for the exact TypeScript implementations.

Commit: `feat: KB_SESSION_ID session isolation for workspace tracking`

### Step 1.3 — Verify

```bash
make test        # all existing tests still pass
make test-race   # if available
```

Manual smoke test:
```bash
# Simulate two sessions
KB_SESSION_ID=aaa kb work start plandent
KB_SESSION_ID=bbb kb work start mykb
KB_SESSION_ID=aaa kb work show   # should show plandent
KB_SESSION_ID=bbb kb work show   # should show mykb
kb work show                     # should show whatever .active has (unchanged)
```

Commit: none — verification only.

---

## Phase 2: vf-agents — `--env` Flag on `vfa run`

**Scope:** `cmd/run.go`, `cmd/session.go`, `internal/domain/types.go`,
`internal/orchestrator/run.go`

### Step 2.1 — RED: Tests for `--env` flag parsing and propagation

Add to `cmd/run_test.go` (or orchestrator integration tests):

```
- --env KEY=VALUE parsed into RunOpts.AdHocEnvVars
- --env KEY=VALUE multiple times → all collected
- --env without VALUE (malformed) → error
- AdHocEnvVars merged into allEnvVars in orchestrator
- AdHocEnvVars appear in ExecOpts.EnvVars passed to executor
```

Commit: `test: --env flag for ad-hoc env var injection`

### Step 2.2 — GREEN: Add `AdHocEnvVars` to `RunOpts`

In `internal/domain/types.go`, add to `RunOpts`:
```go
AdHocEnvVars []EnvVar
```

Commit: `feat: add AdHocEnvVars to RunOpts`

### Step 2.3 — GREEN: Parse `--env` in `cmd/run.go`

```go
envFlags, _ := cmd.Flags().GetStringArray("env")
var adHocEnvVars []domain.EnvVar
for _, e := range envFlags {
    parts := strings.SplitN(e, "=", 2)
    if len(parts) != 2 {
        return fmt.Errorf("invalid --env format %q: expected KEY=VALUE", e)
    }
    adHocEnvVars = append(adHocEnvVars, domain.EnvVar{Name: parts[0], Value: parts[1]})
}
// pass into RunOpts.AdHocEnvVars
```

Add flag definition:
```go
runCmd.Flags().StringArray("env", nil, "Set env var in container: KEY=VALUE (repeatable)")
```

Apply the same change to `cmd/session.go` for `vfa session start`.

Commit: `feat: --env flag for ad-hoc env var injection in run and session`

### Step 2.4 — GREEN: Merge in orchestrator

In `internal/orchestrator/run.go`, after building `allEnvVars`:
```go
allEnvVars = append(allEnvVars, opts.AdHocEnvVars...)
```

Commit: `feat: merge AdHocEnvVars into container env in orchestrator`

### Step 2.5 — Verify

```bash
make test-race
```

Manual smoke test:
```bash
vfa run --provider pi --profile kb --access full \
  --workdir . --interactive \
  --env "KB_SESSION_ID=test123" \
  --env "HELLO=world"
# Inside container: echo $KB_SESSION_ID → test123
#                   echo $HELLO → world
```

---

## Phase 3: bashrc — Shell Functions

**Scope:** `~/.bashrc` only. Replace two existing aliases, add two new ones.

### Step 3.1 — Remove existing aliases

Remove from `~/.bashrc`:
- `kb-claude()` (currently containerized Claude)
- `kb-pi()` (currently containerized Pi)

### Step 3.2 — Add four new functions

```bash
# Host Pi with kb — session-isolated
kb-pi() {
  local sid
  sid=$(uuidgen)
  KB_SESSION_ID="$sid" pi "$@"
}

# Host Claude Code with kb — session-isolated
kb-claude() {
  local sid
  sid=$(uuidgen)
  KB_SESSION_ID="$sid" claude "$@"
}

# Containerized Pi via vf-agents — session-isolated
kb-cpi() {
  local sid
  sid=$(uuidgen)
  vfa run --provider pi --profile kb --access full \
    --workdir "${1:-.}" --interactive \
    --env "KB_SESSION_ID=$sid"
}

# Containerized Claude Code via vf-agents — session-isolated
kb-cclaude() {
  local sid
  sid=$(uuidgen)
  vfa run --provider claude-anthropic --profile kb --access full \
    --workdir "${1:-.}" --interactive \
    --env "KB_SESSION_ID=$sid"
}
```

### Step 3.3 — Reload and verify

```bash
source ~/.bashrc

# Test host Pi session
kb-pi --version   # should launch Pi with KB_SESSION_ID in env

# Test containerized Pi
kb-cpi ~/GitHub/mykb
# Inside container: echo $KB_SESSION_ID → <some uuid>
# Inside container: kb work start mykb
# Inside container: kb work show → shows mykb
# Exit container. Back on host: kb work show → should still show old .active value
```

---

## Testing Checklist

### Isolation scenarios to verify manually after all three phases:

- [ ] Two simultaneous `kb-pi` sessions on host: each can `kb work start` independently
- [ ] `kb-cpi` + `kb-pi` simultaneously: container workspace does not affect host
- [ ] Two simultaneous `kb-cpi` sessions: each container has its own workspace
- [ ] Plain `kb work start` on host (no alias): still writes `.active`, works as before
- [ ] `MYKB_WORKSPACE=x kb work show`: returns `x` regardless of session or `.active`
- [ ] `kb-cclaude` session: `KB_SESSION_ID` present in container env

---

## Commit Summary

| Phase | Commits |
|---|---|
| mykb P1 | `test: KB_SESSION_ID session isolation` → `feat: KB_SESSION_ID session isolation` |
| vf-agents P2 | `test: --env flag` → `feat: AdHocEnvVars to RunOpts` → `feat: --env flag in run and session` → `feat: merge AdHocEnvVars in orchestrator` |
| bashrc P3 | Manual edit + `source ~/.bashrc` (no commit needed) |

---

## Dependencies

- Phase 2 must be complete before `kb-cpi` / `kb-cclaude` work with `KB_SESSION_ID`
- Phase 1 must be complete before any session isolation is effective
- Phase 3 can be written any time but requires Phase 1 + 2 to be fully testable
