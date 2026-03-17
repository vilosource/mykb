# Workspace Artifacts — Design

## Problem

Agents working in a workspace often create files — design documents, migration prompts, scripts, analysis notes. These files are valuable artifacts of the session but are currently invisible to mykb:

- They live somewhere on disk (`~/KB/migrate-area.md`, `/tmp/plan.md`, etc.) with no connection to the workspace that produced them
- An agent picking up a workspace in a new session has no way to know these files exist
- The workspace journal records *what was done* but not *what was created*
- Files can be lost, moved, or forgotten between sessions

A `kb add link` entry can reference a file path, but this is fragile (path-only, no persistence, no enforcement) and not semantically distinct from a URL link to an external system.

## Scope

Only **Markdown files (`.md`)** are tracked as workspace artifacts. Rationale:

- Markdown covers the artifacts that matter: design docs, migration guides, prompts, analysis notes, retrospectives
- Always small text files — no size guards or binary handling needed
- Write-once in practice — drift between original and stored copy is not a concern
- Large files (database dumps, binaries, scripts) can continue to be referenced via `kb add link`

## Command: `kb wsa`

```bash
kb wsa add <path>              # register and persist a .md file into the workspace
kb wsa list                    # list artifacts for the active workspace
kb wsa remove <id>             # unregister an artifact (removes stored copy)
kb wsa show <id>               # print artifact metadata + file content
```

### `kb wsa add <path>`

1. Validates that `<path>` is a `.md` file and exists on disk
2. Resolves the active workspace (see **Active Workspace Resolution** below)
3. Copies the file into `~/.mykb/workspaces/<id>/files/<filename>`
4. Appends an entry to `~/.mykb/workspaces/<id>/artifacts.jsonl`

The original file is left in place (copy, not move). The brain holds the canonical persisted copy. `kb save` commits it to git along with all other brain files.

## Storage

New directory and file per workspace:

```
~/.mykb/workspaces/<id>/
  workspace.json
  journal.jsonl
  artifacts.jsonl        ← new
  files/                 ← new
    migrate-area.md
    design-notes.md
```

### `artifacts.jsonl` schema

```json
{
  "id": "nanoid8",
  "filename": "migrate-area.md",
  "description": "OSB to mykb migration prompt",
  "tags": ["prompt", "migration"],
  "originalPath": "/home/user/KB/migrate-area.md",
  "created_at": "2026-03-17T10:00:00.000Z",
  "updated_at": "2026-03-17T10:00:00.000Z"
}
```

## Context Delivery

Artifact list is included in **Tier 1** context (system prompt) alongside workspace state and journal. Agents always know what files exist for the active workspace at session start, without needing to ask.

Example system prompt inclusion:

```
## Workspace Artifacts
- migrate-area.md — OSB to mykb migration prompt
- design-notes.md — initial architecture design session notes
```

`kb wsa show <id>` serves as **Tier 3** on-demand content injection — dumps the full file content into context when the agent needs to read it.

## Active Workspace Resolution

The active workspace is stored in `~/.mykb/workspaces/.active` — a plain text file
containing the workspace ID. `kb work start <id>` writes to it; all workspace-scoped
commands read from it.

Multiple simultaneous sessions sharing the same brain corrupt each other's workspace
targeting silently. This affects all workspace-scoped commands, not just `kb wsa`,
and is a pre-existing gap that `kb wsa` makes more acute.

**The fix is documented separately:** see [`session-isolation-DESIGN.md`](session-isolation-DESIGN.md).

The solution uses a `KB_SESSION_ID` env var generated at launch time by the shell
functions (`kb-pi`, `kb-claude`, `kb-cpi`, `kb-cclaude`). mykb derives a
per-session state file `/tmp/.mykb-session-<id>` from it, providing isolation
without touching the global `.active` file.

## Open Questions

- Should `kb wsa add` warn if a file with the same name already exists in `files/`? (overwrite silently, error, or prompt?)
- Should `kb wsa remove` delete the stored file from `files/`, or just remove the `artifacts.jsonl` entry?
- Should `kb work show` include the artifact list, or only `kb wsa list`?
- Should the `documents` field already present in `workspace.json` be repurposed for this, or kept separate?

## Relationship to Existing Features

| Feature | Purpose |
|---|---|
| `kb add link` | Pointer to external URLs or file paths — not persisted, not workspace-scoped |
| `kb wsa add` | Persists `.md` files into the brain, workspace-scoped, git-tracked |
| `kb work journal` | Temporal session log — *what was done* |
| `kb wsa` | Artifact registry — *what was created* |
