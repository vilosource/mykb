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

## Design Direction

### The "hooks as nudges" principle

mykb's design philosophy is "use hooks as nudges" — the system ensures the agent sees the right information at the right time, but the agent decides what to do with it. This sits at level 3 on the enforcement spectrum:

> passive observation → context enrichment → **nudge** → tool gating → result transformation → native tools

This principle resolves the central design tension. The question was: auto-load knowledge (forced injection, level 5-6) vs show an index and hope (passive, level 1). The answer is neither — it's a nudge (level 3).

### How skills work (and how this differs)

Claude Code skills use a two-phase system: (1) skill descriptions are always in context, (2) when the agent's response signals intent to use a skill, the **harness** intercepts and injects the full content. The agent doesn't consciously invoke a tool — the system handles content injection transparently.

`kb work start` can't replicate this harness-driven injection. But it doesn't need to. The command output itself IS the nudge — it's already system-initiated (the user runs the command), and the output lands in the agent's context. The problem isn't the mechanism; it's that the current output is a bad nudge. It shows state and journal but doesn't nudge toward knowledge loading.

### What makes a good nudge

The current output already shows `Areas: vmctl`. That IS an index — a minimal one. And it failed. The agent saw it and didn't load knowledge. So the nudge must be qualitatively better, not just quantitatively:

1. **Repo paths rendered** — answers "where is the code?" without any agent initiative
2. **Area summaries with entry counts by type** — "6 gotchas" is a stronger signal than "35 entries" or just an area name. From the knowledge durability research: gotchas have 100% within-project retention and are the highest-value entries for preventing mistakes. Seeing "6 gotchas" should naturally trigger "I need to know what those are."
3. **Explicit load instruction** — `Run 'kb load <id>' for full context` makes the next action obvious. The agent still decides, but the right decision is the obvious one.

The agent retains agency. For trivial tasks ("fix a typo"), skipping the load is correct. For substantial work, the gotcha count signals "load me first." Today the agent doesn't even know the knowledge exists.

### Rendering order

Identity → Repos → State → Knowledge Area Index → Journal → Artifacts

Repos early because "where is the code?" is the first question on cold start. Knowledge index before journal because ground truth (decisions, gotchas, patterns) outranks recency (last 3 sessions).

### What this doesn't solve

- **Agent initiative is still required** — the nudge makes the right action obvious but can't force it. Acceptable: worst case is the same as today, best case the agent loads and avoids traps.
- **Stale knowledge** — the zone lifecycle handles this, but there's a known bug where `kb load` doesn't filter by zone (archived entries still appear). Must be fixed independently.
- **CLAUDE.md contradictions** — if knowledge and CLAUDE.md conflict, that's a curation discipline problem, not a rendering problem.

## Resolving the Unknowns

### Known Unknowns — Resolved

**KU1: Right level of knowledge injection**
→ **Nudge: area index with entry counts and explicit load instruction.** Follows the "hooks as nudges" principle — system surfaces the right information, agent decides. Not auto-load (forced injection violates the nudge philosophy). Not passive index (already failed with `Areas: vmctl`). The qualitative difference is entry counts (especially gotchas) and an explicit next action.

**KU2: Multi-area workspaces**
→ **Non-issue with the index approach.** One row per area. Scales linearly. ~100 tokens for 10 areas vs ~40K tokens for full dump.

**KU3: Consumer differences**
→ **`kb work start` serves CLI agents.** Pi agents get context via extension hooks. Container agents read instruction files. Each consumer has its own injection path. The same underlying data (workspace.json, manifest.json) is available to all. Don't over-generalize the CLI command.

**KU4: Rendering order**
→ **Identity → Repos → State → Knowledge Area Index → Journal → Artifacts.** Repos early (first question on cold start). Knowledge index before journal (ground truth outranks recency).

**KU5: Backward compatibility**
→ **No breakage risk.** Output is consumed as natural language, not parsed structurally. Changes are purely additive.

**KU6: Flag vs default**
→ **Enriched output is the default.** Requiring a flag to get the nudge defeats the purpose. `--brief` for the stripped version if needed, but that's the opt-in.

### Unknown Knowns — Examined

**UK1: "Areas are small enough to inline"**
→ **Moot.** Going with nudge/index approach, not inline. For the record: post-curation areas are 20-60 entries (~3-5K tokens each). Inline works for single-area but not multi-area.

**UK2: "The agent will know to run kb load"**
→ **This was the critical false assumption.** Evidence: the agent saw `Areas: vmctl` in the output and didn't load. Skills work because the harness handles injection — agents don't "know" to load skills. We can't replicate harness-driven injection, but we can make the nudge strong enough that loading becomes the obvious next action. Entry counts + explicit instruction is the mitigation. Risk remains but is acceptable.

**UK3: "Workspace = one project = one area"**
→ **True today, index handles many-to-many naturally.** No special handling needed.

**UK4: "Journal entries provide enough context"**
→ **Confirmed false.** Journal = recency (what happened last). Knowledge = ground truth (what you need to know). Different purposes, both needed. The cold start currently only has journal.

**UK5: "CLAUDE.md handles the rest"**
→ **Different concerns.** CLAUDE.md = static per-repo instructions (how to work). Knowledge areas = dynamic accumulated context (what to know). Neither substitutes for the other.

### Unknown Unknowns — Investigated

**UU1: Other agent consumption patterns**
→ **Not relevant for this fix.** CLI-focused. Other consumers have their own injection paths.

**UU2: Knowledge vs CLAUDE.md contradictions**
→ **Real risk, orthogonal to cold start.** Curation discipline problem, not rendering.

**UU3: Stale knowledge causing worse outcomes**
→ **Mitigated by zones.** Known bug: `kb load` doesn't filter by zone. Fix independently.

**UU4: Index nudge backfiring**
→ **Acceptable risk.** Gotcha counts mitigate. Worst case = same as today. Agent retains judgment for trivial tasks where skipping is correct.

**UU5: Token cost**
→ **Non-issue.** Index: ~50 tokens/area. Full load: ~3-5K tokens/area. 100x cheaper.

**UU6: Wasteful workspace types**
→ **Non-issue.** Workspace existence implies context is worth surfacing.
