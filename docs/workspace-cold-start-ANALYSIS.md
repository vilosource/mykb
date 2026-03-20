# Workspace Cold Start Context Gap

## Problem

`kb work start <id>` is the primary entry point for AI agents beginning work on a project. It activates the workspace and renders its current state. However, the output is missing critical context that agents need to work effectively, forcing manual follow-up commands and filesystem exploration before any real work can begin.

### What's missing

**1. Repository paths are stored but not rendered**

Workspace metadata stores repo paths in `links.repos`, but `renderWorkspace()` in `render.ts` only displays `jira` and `wiki` links — `repos` is silently dropped. This means the agent doesn't know where the code lives and resorts to searching the filesystem (`find`, `locate`, checking common directories) to discover something the workspace already knows.

Observed behavior: agent ran 6 exploratory commands across `/home/*/GitHub/`, `/home/*/projects/`, `/home/*/src/` before finally reading `workspace.json` directly to find the repo path that was there all along.

**2. No knowledge area index**

Workspaces link to knowledge areas, but `kb work start` doesn't surface what those areas contain or even hint that they should be loaded. The agent gets workspace state (phase, active, blocked, next) and recent journal entries, but has zero knowledge context — no facts, no decisions, no gotchas, no patterns.

On a cold start, the agent doesn't know:
- What technology stack the project uses
- What architectural decisions were made and why
- What gotchas to avoid
- What patterns to follow

All of this is captured in the linked knowledge areas, but the agent has to independently discover that `kb load <area>` exists and decide to run it. In practice, the agent proceeds without this context and makes avoidable mistakes (wrong assumptions about how the project runs, unnecessary exploration of solved problems).

**3. The compound effect**

These gaps compound. Without the repo path, the agent searches the filesystem. Without knowledge context, it reads random files trying to understand the project. Without gotchas, it falls into known traps. Each missing piece triggers exploratory work that the workspace was designed to eliminate.

The workspace is meant to be a cold-start bundle — everything an agent needs to begin productive work. Today it's a status display with a journal.

### Evidence

Session 2026-03-20, vmctl workspace:
- Agent ran `kb work start vmctl`, got state and journal
- Needed to find the repo → ran `find` across 6 directories, checked `~/GitHub/`, `~/projects/`, `~/src/`, `~/repos/`, `~/go/src/`
- Eventually read `workspace.json` directly to find `links.repos`
- Needed project knowledge → had to separately run `kb load vmctl` later
- Assumed the Go app runs via `go run` locally (wrong — it's fully Dockerized), a fact captured in the vmctl knowledge area

Same session, mykb workspace:
- Agent ran `kb work start mykb`, got state and journal
- Repo path not shown — had to recall it from a previously loaded knowledge entry
- No knowledge loaded — would have needed `kb load mykb` on a true cold start to know the tech stack, architecture, and current state of the codebase

## Rumsfeld Matrix

### Known Knowns (things we know and understand)

- `links.repos` is stored in workspace.json but `renderWorkspace()` skips it — confirmed in render.ts lines 100-105
- Agents need repo paths, tech stack, decisions, and gotchas to work effectively on cold start
- Knowledge areas already contain this information — the data exists, it's just not surfaced
- The three-tier context delivery model (index → auto-inject → on-demand) is the right pattern
- `kb load <area>` works and produces good output — the rendering is solved, just not triggered
- Workspace `areas` array defines which knowledge areas are relevant — curation is already done by the user
- Area summaries exist in `manifest.json` — lightweight index data is available without loading full entries
- Journal and state rendering already work well — the workspace start output structure is sound

### Known Unknowns (things we know we need to figure out)

- **Right level of knowledge injection**: Full `kb load` dump vs area summary index vs something in between? Loading all entries may be too much for workspaces with many areas. Just summaries may not be enough to prevent mistakes.
- **Multi-area workspaces**: How does this scale when a workspace links 5-10 areas? What's the right output budget?
- **Consumer differences**: Claude Code agents read stdout, Pi agents get context via hooks, container agents get instructions files. Does `kb work start` need to serve all of these, or just the CLI consumer?
- **Rendering order**: What should come first — state, repos, knowledge, journal? What does the agent scan first?
- **Backward compatibility**: Does changing the output break existing workflows or agent instructions that parse `kb work start` output?
- **Flag vs default**: Should the enriched output be the default, or opt-in via a flag? What about a `--brief` for the current behavior?

### Unknown Knowns (assumptions and intuitions we haven't examined)

- **"Areas are small enough to inline"** — true for vmctl (~40 entries) but is this true for all areas? Some areas post-curation are lean, others may not be. We haven't measured the distribution.
- **"The agent will know to run kb load"** — we assume agents understand the kb command set, but the evidence shows they don't proactively load areas unless prompted. The current design relies on agent initiative that doesn't reliably exist.
- **"Workspace = one project = one area"** — most workspaces today map 1:1 to an area, but the data model supports many-to-many. The solution needs to work for both cases.
- **"Journal entries provide enough context"** — 3 recent entries cover what happened last, but not the accumulated knowledge. Recency bias — the journal tells you the last session's work, not the project's ground truth.
- **"CLAUDE.md handles the rest"** — there's an assumption that project CLAUDE.md files fill the knowledge gap, but CLAUDE.md is per-repo static instructions, not per-workspace dynamic knowledge.

### Unknown Unknowns (blind spots to investigate)

- How do other agents (Pi, container agents, vtaskforge workers) actually consume workspace output today? Are there consumption patterns we haven't observed?
- What happens when workspace knowledge and repo CLAUDE.md contradict each other? Which takes precedence and does the agent know?
- Are there workspaces where the linked areas are stale or irrelevant? Would auto-loading stale knowledge cause worse outcomes than loading nothing?
- Could the area index nudge pattern backfire — agent sees the index, decides it doesn't need to load, and misses critical gotchas?
- What's the token cost of including area knowledge in the cold start output? Does it meaningfully reduce the context window budget for actual work?
- Are there workspace types (debugging sessions, quick fixes, exploration) where full context loading is wasteful?
