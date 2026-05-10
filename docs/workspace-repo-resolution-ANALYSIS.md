# Workspace Repo Path Resolution Gap

## Problem

`kb work start` now renders repo paths (fix from `workspace-cold-start-ANALYSIS.md`), but displays them as stored — remote identifiers like `vilosource/vafi` — without resolving to local filesystem paths. AI agents see `Repos: vilosource/vafi` and still don't know where the code lives on disk.

### Observed failure

Session 2026-03-23, vafi workspace:
1. Agent ran `kb work start vafi`, output included `Repos: vilosource/vafi, vilosource/vf-agents`
2. User asked to look at ansible playbooks in the vafi repo
3. Agent searched `/home/jasonvi/KB/vafi/` (the CWD, which is the workspace anchor — not the code repo) and found it empty
4. Agent spawned an Explore subagent to search the entire home directory
5. User had to manually tell the agent the repo was at `/home/jasonvi/GitHub/vafi/`

The agent had a feedback memory saying "use workspace links immediately" and still failed — because the rendered output gave a remote identifier, not a usable path.

### Root cause

The `renderWorkspace()` function in `render.ts` (line 104-106) renders `links.repos` verbatim:

```typescript
if (workspace.links.repos && workspace.links.repos.length > 0) {
  lines.push(`Repos: ${workspace.links.repos.join(', ')}`);
}
```

The workspace JSON stores repos as remote identifiers:

```json
"links": {
  "repos": ["vilosource/vafi", "vilosource/vf-agents"]
}
```

No mapping from remote identifier to local checkout path exists anywhere in the system.

## Why the current nudge fails

The cold-start analysis established the "hooks as nudges" principle: surface enough information that the agent naturally takes the right action. The repo line is a nudge, but it's a **broken nudge** — it tells the agent that repos exist without telling it where they are. The agent has three options, all bad:

1. **Guess** the path from the identifier (requires knowing the local convention: `vilosource/X` → `~/GitHub/X/`)
2. **Search** the filesystem (`find`, `locate`, exploring common directories)
3. **Ask** the user

Option 1 is fragile and convention-dependent. Options 2 and 3 waste time. The nudge should make the right action require zero inference.

## Design options

### Option A: Resolve at render time (convention-based)

Apply a configurable path convention to map remote identifiers to local paths during rendering.

```
## Code Repositories
- vilosource/vafi → ~/GitHub/vafi
- vilosource/vf-agents → ~/GitHub/vf-agents
```

**How it works:**
- Add a `repo_base_path` config (e.g., `~/GitHub`) to mykb settings or workspace metadata
- At render time, extract the last segment of the remote identifier and join with the base path
- Optionally verify the path exists and annotate if missing

**Pros:** Zero storage overhead, works for existing workspaces, single config change applies globally
**Cons:** Breaks if repos are checked out to non-standard locations, convention must match reality

### Option B: Store local paths explicitly

Change `links.repos` to store objects with both remote and local paths:

```json
"links": {
  "repos": [
    {"remote": "vilosource/vafi", "local": "/home/jasonvi/GitHub/vafi"},
    {"remote": "vilosource/vf-agents", "local": "/home/jasonvi/GitHub/vf-agents"}
  ]
}
```

**Pros:** Exact, no convention assumptions, handles non-standard checkout locations
**Cons:** Breaking change to repos schema, requires migration of existing workspaces, more verbose `kb work create` invocations

### Option C: Hybrid — convention with override

Store repos as strings (current format). Add a global `repo_base_path` config. At render time, resolve using the convention. Allow per-repo overrides in workspace metadata for non-standard locations.

```json
// Global config (~/.mykb/config.json)
{ "repo_base_path": "~/GitHub" }

// Workspace repos — strings use convention, objects override
"repos": [
  "vilosource/vafi",
  {"remote": "vilosource/vf-agents", "local": "/opt/special/vf-agents"}
]
```

**Pros:** Backward compatible, works for 95% of cases via convention, handles exceptions
**Cons:** Mixed types in the array, more complex rendering logic

### Option D: Render with existence check

Same as Option A but verify the path exists at render time. Show the resolved path if it exists, show the raw identifier with a warning if not.

```
## Code Repositories
- vilosource/vafi → ~/GitHub/vafi
- vilosource/vf-agents → ~/GitHub/vf-agents (not found locally)
```

**Pros:** Agent knows immediately if a repo needs to be cloned
**Cons:** Adds filesystem I/O to rendering, slightly slower

## Recommendation

**Option A (convention-based resolution)** with existence check from Option D.

Rationale:
- Simplest implementation — one config value, one render change
- No schema migration needed
- Existence check adds negligible I/O (one `stat` per repo)
- Covers the actual use case: all repos follow `~/GitHub/<name>/` convention today
- If a non-standard location emerges later, upgrade to Option C

### Proposed rendering

```
## Code Repositories
- ~/GitHub/vafi (vilosource/vafi)
- ~/GitHub/vf-agents (vilosource/vf-agents)
```

Local path first (actionable), remote identifier in parentheses (for reference). Agent sees the path, uses it immediately, no inference required.

If path doesn't exist:

```
## Code Repositories
- vilosource/vafi (not found at ~/GitHub/vafi)
```

### Implementation sketch

1. Add `repo_base_path` to mykb config (default: `~/GitHub`)
2. In `renderWorkspace()`, resolve each repo string: extract last path segment, join with base path
3. `fs.existsSync()` check on the resolved path
4. Render local path first if exists, raw identifier with warning if not
5. Update `kb work create --repos` docs to note the convention

### Configuration

```bash
kb config set repo_base_path ~/GitHub
```

Or in `~/.mykb/config.json`:
```json
{ "repo_base_path": "~/GitHub" }
```

## Priority

This is a single-session fix — one config value, one render function change, a few tests. The impact is high: every cold start on every workspace benefits. Should be done before the next M2 work session on vafi.

## Relationship to prior work

- **workspace-cold-start-ANALYSIS.md** — identified the repo rendering gap (repos stored but not shown). That gap was fixed. This is the next gap: repos shown but not actionable.
- **workspace-cold-start-IMPLEMENTATION.md** — implemented repo rendering and knowledge area index. This extends that work with path resolution.
- **feedback_workspace_links.md** (agent memory) — documents the same failure pattern. This fix eliminates the root cause so the feedback memory becomes unnecessary.
