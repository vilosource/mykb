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

Add to `tests/core/workspace.test.ts` (existing file):

```
- getActiveWorkspaceId() with KB_SESSION_ID set + session file exists → returns file content
- getActiveWorkspaceId() with KB_SESSION_ID set + no session file → returns null
- getActiveWorkspaceId() with KB_SESSION_ID not set + .active exists → returns .active content
- getActiveWorkspaceId() with MYKB_WORKSPACE set → returns env var value (ignores session file and .active)
- getActiveWorkspaceId() with MYKB_WORKSPACE + KB_SESSION_ID both set → MYKB_WORKSPACE wins
- setActiveWorkspaceId() with KB_SESSION_ID set → writes to session file, .active unchanged
- setActiveWorkspaceId() with KB_SESSION_ID not set → writes to .active
- clearActiveWorkspaceId() with KB_SESSION_ID set → removes session file, .active unchanged
- clearActiveWorkspaceId() with KB_SESSION_ID not set → removes .active
```

**Env var hygiene:** Each test must save and restore `process.env.KB_SESSION_ID` and
`process.env.MYKB_WORKSPACE` to avoid cross-test pollution. The existing
`withTempBrain` helper saves/restores `MYKB_DIR` but not these two. Use a
`beforeEach`/`afterEach` block in the new `describe` section, or inline
save/restore per test.

**Session file paths:** Use `os.tmpdir()` in the implementation (not hardcoded
`/tmp/`) for cross-platform safety. In tests, each test gets isolation via unique
`KB_SESSION_ID` values (e.g. `test-${randomUUID()}`).

Commit: `test: KB_SESSION_ID session isolation for workspace tracking`

### Step 1.2 — GREEN: Implement in `workspace.ts`

Update three methods in `FileSystemWorkspaceStorage`:

**`getActiveWorkspaceId()`** — priority chain: `MYKB_WORKSPACE` → session file → `.active`

**`setActiveWorkspaceId(id)`** — writes session file when `KB_SESSION_ID` set, else `.active`

**`clearActiveWorkspaceId()`** — removes session file when `KB_SESSION_ID` set, else `.active`

Use `os.tmpdir()` for the session file base path:
```typescript
import os from 'node:os';

private sessionFile(): string | null {
  const sessionId = process.env.KB_SESSION_ID?.trim();
  if (!sessionId) return null;
  return path.join(os.tmpdir(), `.mykb-session-${sessionId}`);
}
```

See `session-isolation-DESIGN.md` for the full method implementations.

**Edge case — `MYKB_WORKSPACE` + `kb work start`:** When `MYKB_WORKSPACE` is set,
`getActiveWorkspaceId()` always returns it, but `setActiveWorkspaceId()` still
writes to the session file or `.active`. This means `kb work start X` succeeds
but `kb work show` still returns `MYKB_WORKSPACE`. This is acceptable: `MYKB_WORKSPACE`
is an explicit override for scripted use and should not be combined with interactive
`kb work start`. No warning needed in v1.

Commit: `feat: KB_SESSION_ID session isolation for workspace tracking`

### Step 1.3 — Build and verify

```bash
npm run build    # rebuild CLI bundle
npm test         # all existing + new tests pass
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

**Scope:** `cmd/run.go`, `cmd/session.go`, `internal/orchestrator/run.go`

Note: `RunOpts` is defined in `internal/orchestrator/run.go`, not `domain/types.go`.

### Step 2.1 — RED: Tests for `--env` flag parsing and propagation

Add to orchestrator tests (`internal/orchestrator/run_test.go`):

```
- RunOpts.AdHocEnvVars merged into ExecOpts.EnvVars passed to executor
- Multiple AdHocEnvVars all appear in container env
- Empty AdHocEnvVars → no effect on existing env vars
```

Add to CLI-level tests if applicable:
```
- --env KEY=VALUE parsed correctly
- --env KEY=VALUE repeatable (multiple flags)
- --env without = separator → error
```

Commit: `test: --env flag for ad-hoc env var injection`

### Step 2.2 — GREEN: Implement `--env` flag end-to-end

All changes in one commit — they form a single atomic feature:

**`internal/orchestrator/run.go`** — add `AdHocEnvVars` to `RunOpts`:
```go
type RunOpts struct {
    // ... existing fields ...
    AdHocEnvVars []domain.EnvVar
}
```

Merge in the orchestrator, after profile env vars:
```go
allEnvVars = append(allEnvVars, opts.AdHocEnvVars...)
```

**`cmd/run.go`** — parse `--env` flag:
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
```

Add flag definition:
```go
runCmd.Flags().StringArray("env", nil, "Set env var in container: KEY=VALUE (repeatable)")
```

**`cmd/session.go`** — same `--env` flag on `vfa session start`.

Commit: `feat: --env flag for ad-hoc env var injection`

### Step 2.3 — Verify

```bash
make test-race   # all tests pass
make install     # install updated vfa binary
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

**Note on workdir handling:** Host functions (`kb-pi`, `kb-claude`) pass `"$@"`
directly to the runtime — the user `cd`s to the project directory before launching.
Containerized functions (`kb-cpi`, `kb-cclaude`) take an explicit workdir argument
(`${1:-.}`) because vf-agents needs to bind-mount it. This is intentionally different.

### Step 3.3 — Reload and verify

```bash
source ~/.bashrc

# Test host Pi session
kb-pi    # should launch Pi with KB_SESSION_ID in env

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
| vf-agents P2 | `test: --env flag for ad-hoc env var injection` → `feat: --env flag for ad-hoc env var injection` |
| bashrc P3 | Manual edit + `source ~/.bashrc` (no commit needed) |

---

## Dependencies

- Phase 2 must be complete before `kb-cpi` / `kb-cclaude` work with `KB_SESSION_ID`
- Phase 1 must be complete before any session isolation is effective
- Phase 3 can be written any time but requires Phase 1 + 2 to be fully testable
