# `kb recent` — cold-start activity digest — DESIGN

> **Status:** design accepted; implementation on `feature/kb-recent`. Tracked by [issue #8](https://github.com/vilosource/mykb/issues/8).
>
> **Motivation (from the operator):** "I often work on multiple workspaces using different Claude Code / Pi instances. I start a session by asking 'what were the things we worked on yesterday' before I load a workspace — it helps me remember what I touched. I'd like a command that gives an overall summary of which areas / which workspaces were last worked on, with enough of a one-liner to recall what the work was about."

## Problem

There is no cross-cutting "recent activity" view. `kb work list` lists *all* workspaces with no recency or content; `kb stats` counts entries; `kb stale` finds stale entries; `kb work journal --show N` shows the *active* workspace's journal only. So the operator's "what did I touch yesterday, across everything" question can only be answered by hand-reconstructing it from the `~/.mykb` git log + per-workspace journals — which is exactly what an agent has to do when asked, every session.

## Solution: `kb recent`

A read-only command that scans the brain and prints, ranked by last activity:

```
kb recent [-d N | --days N | --since <YYYY-MM-DD>] [--all] [--git] [--full] [--json]
```

| Flag | Meaning | Default |
|---|---|---|
| `-d N`, `--days N` | window = "now − N days" | **`-d 2`** |
| `--since <date>` | window = entries with `date/updated >= <date>` (ISO date or full ISO timestamp); overrides `--days` | — |
| `--all` | ignore the window — rank *everything* (incl. archived workspaces) by last activity | off |
| `--git` | also print the `~/.mykb` git commit log over the window, grouped by day | off |
| `--full` | per workspace, show up to 5 in-window journal lines instead of just the latest | off |
| `--json` | emit the structured `RecentActivity` object instead of rendered text | off |

### Output (two sections)

**WORKSPACES** — for each workspace with activity in the window, newest first:
- `* ` marker if it is the currently-active workspace (`getActiveWorkspaceId()`), same convention as `kb work list`.
- workspace id, last-activity (relative — `2h ago` / `yesterday` / `3d ago`), and **the activity count** — journal entries + notes added in the window (`13 entries`, `1 entry`).
- the workspace's current `state.phase` (the "where it stands" line).
- a one-liner — the **latest in-window journal entry's text, truncated** (~250 chars; `--full` shows up to 5). If there is no in-window journal entry (e.g. only `kb work state` ran), fall back to: the handoff's first non-empty line → `state.active` → `state.next` → `(no journal entry in window)`.

**AREAS** — for each area whose resolved entries include one with `updated >= since`, newest first: area id, count of entries touched in the window, last-touched timestamp.

`--all` drops the window filter (still ranked by last activity); archived workspaces (`workspaces/archive/<id>/`) are included only under `--all`.

### Sample (`kb recent -d 1`)

```
Recent activity — since 2026-05-10 (1 day)

WORKSPACES
  reviewpixie     2h ago    8 entries   fork executed; building it out — linter floor + grounding done
    └ Session 5 continued: wired the linter findings into the LLM review prompt. linters/run.sh gained
      --format review-context; new experiments/linter-grounding/ (5/5 green)…
* mykb            3h ago   13 entries   v2-implementation
    └ Closed the 3 scaffolded-only matrices: kb-add L4 (4), kb-verify L4 (3), kb-command (3 + fixed the never-worked /kb bug)…
  devops          5h ago    1 entry     cramo-backup-incident: mitigated, root-cause fix pending
    └ Cramo GRS backup leak: DiskSpaceLow on cramo-se-1 traced to grs_backup_integration_files.sh…
  …

AREAS
  reviewpixie     4 entries   (last 2026-05-11 14:56)
  mykb            2 entries   (last 2026-05-11 14:45)
  hetzner         1 entry     (last 2026-05-11 13:53)
  …
```

## "Last activity" — the rule that needs pinning

`workspace.json`'s `updated` field is **not** a reliable last-activity proxy: `kb work journal` and `kb work handoff` don't bump it (only `kb work state` / `kb work link` etc. do). So:

```
lastActivity(ws) = max(
  ws.updated,
  latest journal entry's `date` (journal.jsonl is append-only ⇒ last line = newest),
  max over resolved notes' `date`,
  handoff `updated`        // present iff a handoff has been written
)
activityCount(ws, since) = (# journal entries with date >= since) + (# resolved notes with date >= since)
```

A workspace with `lastActivity < since` (and no `--all`) is not listed. Areas: a `KnowledgeEntry`'s `updated` (post-tombstone-resolution, via `readAllEntries`) `>= since` ⇒ counted.

All timestamps used are the **in-file ISO strings**, not file mtimes — mtimes are not stable across a `git checkout` of the brain repo; the stored `date`/`updated` fields are.

## Implementation

- **`src/core/recent.ts`** — `getRecentActivity(brainPath, wsStorage, opts): RecentActivity`. Pure read: uses `wsStorage.listWorkspaces()` / `readJournal` / `readNotes` / `readHandoff` for workspaces, `listAreas(brainPath)` + `readAllEntries(brainPath, areaId)` for areas, `wsStorage.getActiveWorkspaceId()` for the active marker. No SQLite, no git, no network — testable with `withTempBrain`. `opts = { since?: string; days?: number; all?: boolean; fullJournal?: boolean }`; the cutoff comes from `opts.since` or `cutoffForDays(opts.days ?? 2)` (reuses `src/core/journal-window.ts`).
- **`src/core/recent.ts`** also exports `renderRecent(activity, { full }): string` — the text rendering (relative-time helper, the two-section layout). Kept next to the data fn, same as `render.ts` patterns.
- **`src/cli/cli.ts`** — registers `program.command('recent')` with the flags above; constructs `FileSystemWorkspaceStorage`, calls `getRecentActivity`, then `renderRecent` (or `JSON.stringify` for `--json`). `--git` is handled in the CLI layer only (shells out to `git -C <brainPath> log --since=<cutoff>`), so the core fn stays git-free; a non-repo brain prints `(brain is not a git repo)` rather than erroring.
- **`CLAUDE.md`** key-commands list and the project README get a `kb recent` line.

## Test layers (per `docs/development-MANIFESTO.md` §3)

`kb recent` is a **new, read-only CLI command** — the manifesto's "New CLI command or flag" row requires **Layer 1 (unit) + Layer 2 (CLI integration)**, and nothing else:

- **No Layer 3** — it reads shared state but mutates nothing, so there is no concurrency-safety obligation.
- **No Layer 4** — it has no Pi-runtime surface (no hook, no context injection, no scorer change). Per the manifesto, pure CLI mechanics covered by L1–L2 need no kb-spike experiment; adding a hollow one would be the "test the layer for its own sake" anti-pattern. (If a future *phase 2* — auto-injecting a `<mykb-recent>` block when no workspace is active — is ever built, *that* would be L4. It is explicitly out of scope here.)

**Layer 1 — `tests/core/recent.test.ts`** (against `withTempBrain`):
- ranking: a workspace whose newest journal entry is yesterday outranks one whose newest is last week.
- the window filter: `-d 2` excludes a workspace whose only activity is 5 days old; `--all` includes it.
- activity count = in-window journal entries + in-window notes (notes resolve tombstones — a deleted note doesn't count).
- `lastActivity` uses the max of `workspace.updated` / journal / notes / handoff — a workspace whose `workspace.json` `updated` is old but whose journal has a today entry still ranks as "today".
- the summary one-liner: latest in-window journal entry; the fallback chain when there's no in-window journal entry.
- areas: an area with one entry `updated` today and three older shows count 1 under `-d 2`; an area with no recent entries is omitted.
- the active-workspace marker reflects `getActiveWorkspaceId()`.
- empty brain → empty `RecentActivity` (no throw).
- `renderRecent` output: section headers, the `*` marker, relative-time strings, truncation of long journal text.

**Layer 2 — `tests/cli/recent.test.ts`** (spawns `node dist/cli/cli.js recent ...` against a temp brain):
- exit 0 on a brain with workspaces; output contains the workspace id, its phase, and the journal one-liner.
- `--json` emits valid JSON with the expected keys.
- `-d 1` vs `-d 30` change which workspaces appear (round-trip: create workspaces, journal at controlled dates, assert the window cut).
- `--all` includes an archived workspace.
- `--git` on a git-repo brain includes a commit subject; on a non-repo brain prints the "(not a git repo)" note and still exits 0.
- empty brain → exit 0, an "(no recent activity)" line, no crash.

## Out of scope

- Phase 2 (extension auto-inject of a `<mykb-recent>` block when no workspace is active) — the operator explicitly does **not** want this; `kb recent` is invoked, never ambient.
- A `--workspace <id>` drill-down — `kb work journal --show N` already covers per-workspace; `kb recent` is the cross-cutting view.
- Anything that mutates the brain.
