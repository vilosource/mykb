# mykb v0.1.0 Implementation Retrospective

Date: 2026-03-16

## Overview

mykb v0.1.0 was designed and implemented in a single session. 11 phases, 5 milestones, 234 unit/integration tests, 11 LLM acceptance tests. The session covered the full arc: problem discovery → research → design → spikes → implementation → testing.

---

## What Worked

### Design-first approach
Spending time on design documents before writing code paid off massively. The design-status.md went through 3 review passes, surfacing 21 issues before a single line of code was written. Issues found in design are 10x cheaper than issues found in implementation.

### Spike experiments before implementation
Three small spikes (context injection, tool gating, SQLite in Pi) validated the architectural pillars in ~1 day. This prevented building 234 tests on an architecture that might not work. Spike 02 caught the `event.toolName` vs `event.tool` property naming issue that would have been much harder to debug later.

### TDD with subagents
Delegating phases to subagents with detailed prompts worked well. Each agent produced clean code with tests. The RED→GREEN commit sequence was mostly followed. The main agent staying out of implementation and focusing on review/merge was the right separation.

### Bottom-up implementation order
Building types → store → db → facade → CLI → extension → delivery → gating followed the dependency graph naturally. Each phase could be tested independently. No phase required code from a later phase.

### Detailed agent prompts
Listing specific files to read, exact function signatures, TDD steps with commit messages, and the CWD reset reminder prevented most agent mistakes. The more specific the prompt, the better the output.

### Phase gates
Reviewing each phase before merging caught issues early. The git branch workflow (feature branch → review → merge) provided a clean safety net.

### Parallel research agents
Using multiple research agents in parallel (e.g., OSB area format + Pi packaging research simultaneously) saved significant time during the design phase.

### OSB workspace for session continuity
Using `osb load mykb` and `osb journal` to track progress meant the session state was captured and recoverable. The mykb workspace in OSB became the project's memory.

---

## What Didn't Work

### Parallel implementation agents
Running Phase 2 (JSONL Store) and Phase 3 (SQLite + FTS5) in parallel caused problems:
- Both agents shared the same working directory
- Phase 3 committed a test file directly to develop instead of its feature branch
- Required a `git revert` on develop to clean up
- Merge conflicts when Phase 2 tried to merge

**Lesson:** Sequential phases only when agents share a working directory. Parallel execution needs true git worktree isolation.

### Worktree isolation failed
Attempted to use `isolation: "worktree"` for Phase 0 but it failed because the main agent's CWD (`/home/jasonvi/OSB`) wasn't a git repo. Fell back to manual feature branches.

**Lesson:** Worktree isolation requires the main agent to be inside the target git repo. Either cd into the repo before launching, or use manual branches.

### Phase 6+7 agent didn't use feature branch properly
The agent created files but didn't commit them to the branch. They ended up as untracked files on develop, requiring manual `git add` and commit.

**Lesson:** Agent prompts need explicit "commit everything, push the branch" instructions. Don't assume the agent will follow the branch workflow without being told.

### Extension loading in Pi containers
Significant debugging time spent figuring out how Pi discovers and loads extensions:
- First attempt: mounted compiled JS — Pi didn't recognize it
- Second attempt: renamed .js to .ts — Pi's TypeScript compiler rejected the esbuild output
- Third attempt: loader wrapper with dynamic import — didn't work
- Fourth attempt: mounted entire project — Pi didn't find the extension
- Fifth attempt: .js file + `pi.extensions` field in package.json — worked

**Lesson:** Research the exact loading mechanism BEFORE building the bundle. The spike worked because it was a simple .ts file. The real extension needed `package.json` with `pi.extensions` field and a `.js` entry point.

### better-sqlite3 native module cross-compilation
Host-compiled `better-sqlite3` didn't work in the container (or SQLite WAL mode required write access). Had to compile inside the container via `docker run npm install`.

**Lesson:** Native Node.js modules must be compiled for the target platform. Document the `docker run npm install` step as part of the build process.

### vfa extra_volumes not wired
Discovered during acceptance testing that `extra_volumes` in vfa profiles was defined in the type system but never implemented in the orchestrator. Brain mount was silently ignored.

**Lesson:** Verify the full toolchain works end-to-end before relying on it. A spike that tests the exact deployment path (not just the extension logic) would have caught this earlier.

### Plugin mounts are read-only
vfa mounts plugins as read-only. The mykb extension needs write access to the brain for SQLite. Required the `extra_volumes` fix in vfa.

**Lesson:** Understand the constraints of the container orchestration tool before designing the deployment model.

### Tool gating event property mapping
The extension's `tool_call` handler used `event.tool` and `event.params` but Pi uses `event.toolName` and `event.input`. This was caught in the spikes but reintroduced in the real implementation because the bundle wrapper used different property names.

**Lesson:** When a spike proves something works, copy the exact working pattern into the real code. Don't rewrite the event handling differently.

### Tier 1 before_agent_start handler
Two bugs:
1. Handler took no parameters — Pi passes `(event, ctx)`. Handler was silently ignored.
2. Handler replaced the system prompt instead of appending to `event.systemPrompt`.
3. Manifest was empty because `appendEntry` auto-creates areas but didn't regenerate the manifest.

**Lesson:** Pi event handlers have specific signatures. The stubs in `pi-types.ts` must match the real Pi API. Test with the actual Pi runtime, not just unit tests.

---

## What Could Be Improved

### A deployment spike alongside logic spikes
We had 3 spikes testing Pi's extension API (context injection, tool gating, SQLite). But none tested the full deployment path: build → bundle → mount into container → extension loads → tools register → brain accessible. A fourth spike testing this would have saved hours of debugging during acceptance testing.

### Bundle build as a documented step in the implementation plan
The esbuild bundling + container npm install workflow was discovered during acceptance testing, not planned. This should be a documented build step in the implementation plan with its own verification.

### Pi type stubs need validation
The `pi-types.ts` stubs were written based on documentation, not verified against Pi's actual TypeScript types. The `before_agent_start` handler signature was wrong. A validation step — importing real Pi types and comparing against stubs — would catch mismatches.

### LLM acceptance test setup automation
The acceptance test setup (seed brain, create vfa profile, rebuild bundle) was manual and error-prone. A `make test-acceptance` target that handles all setup would reduce friction and ensure repeatability.

### Research agent quality
One research agent ran for 7+ hours and had to be killed. Agent prompts for research should include a time budget or scope constraint ("return within 10 web searches").

### Phase gate as a checklist script
The phase gates are documented but verified manually. A `scripts/phase-gate.sh` that runs tests, checks for `any` types, greps for disallowed imports, and verifies TDD commit sequence would automate the gate.

### Document the "known working" extension format earlier
The final working extension format (`.js` file + `package.json` with `pi.extensions` + container-compiled `node_modules`) should have been documented as a gotcha in the design phase, not discovered during acceptance testing.

---

## Metrics

| Metric | Value |
|--------|-------|
| Design documents produced | 12 |
| Review passes on design | 3 (21 issues found and fixed) |
| Spikes run | 3 (all passed) |
| Implementation phases | 11 |
| Subagent launches | 8 (Phase 0-5 individual, 6+7 combined, 8 individual, 9+10 combined) |
| Unit/integration tests | 234 |
| LLM acceptance tests | 11 (10 passed first try, 1 required debugging) |
| Bugs found during acceptance testing | 4 (event property mapping, before_agent_start signature, manifest regeneration, bundle format) |
| vfa bugs discovered | 1 (extra_volumes not wired) |

## Recommendations for Future Implementation Plans

1. **Include a deployment spike** that tests the full path from source to running in the target environment
2. **Document the build/bundle/deploy workflow** as a phase in the plan, not an afterthought
3. **Add a `make test-acceptance` target** for repeatable LLM testing setup
4. **Validate type stubs** against real library types before building on them
5. **Sequential agents only** unless true worktree isolation is available
6. **Copy spike patterns exactly** into real implementations — don't rewrite
7. **Time-bound research agents** to prevent runaway tasks
8. **Automate phase gates** with a script
9. **Add agent workflow section** to every implementation plan (what we just did for workspaces)
10. **Test the container deployment path** before writing acceptance tests that depend on it
