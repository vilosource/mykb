# Workspaces Implementation Plan

Parent: [workspaces-DESIGN.md](workspaces-DESIGN.md) | Manifesto: [development-MANIFESTO.md](development-MANIFESTO.md)

## Approach

Bottom-up, same as the core mykb build. Each phase produces something testable and demonstrable. TDD: failing test first, then implementation.

## Testing Layers

| Layer | What it tests | How |
|-------|--------------|-----|
| **Unit tests** | Workspace CRUD, journal append/read, state updates | Vitest with `withTempBrain` |
| **Integration tests** | CLI `kb work *` commands produce correct output and side effects | Vitest invoking compiled CLI |
| **LLM acceptance tests** | AI uses workspace tools, context pre-loading works, journal captured | `vfa run/session` with mykb-dev profile |

## Phase Gates

Same gates as core mykb — enforced between every phase:

**Code gate:** All tests pass, no `any`, interfaces before implementations, DI, error handling.
**TDD gate:** Git log shows RED → GREEN → REFACTOR sequence.
**LLM gate (Phase 3 only):** AI uses workspace tools correctly, context pre-loads on session start.

## Test Isolation

All tests use `withTempBrain`. Workspace files live inside the brain directory at `workspaces/`.

---

## Phase W1: Workspace Core — Types, Storage, CRUD

**Goal:** Create, read, update, list, archive workspaces. Append and read journal entries.

**SOLID focus:** Single Responsibility — `workspace.ts` handles workspace metadata CRUD, `journal.ts` handles journal append/read. Interface Segregation — workspace operations don't depend on knowledge store.

**Pattern:** Repository — workspace storage is file-based JSON, same pattern as `area.ts`. Journal uses JSONL, same pattern as `store.ts`.

**Development process:**

1. **Types.** Add to `src/core/types.ts`:
   - `WorkspaceState`: `{ phase, active, blocked, next }`
   - `WorkspaceLinks`: `{ jira?, wiki?, repos?, docs? }`
   - `Workspace`: `{ id, name, state, areas, links, created, updated }`
   - `JournalEntry`: `{ date, text }`
   Commit: `feat: add workspace and journal types`

2. **Workspace CRUD.** File: `src/core/workspace.ts`. Test: `tests/core/workspace.test.ts`
   - RED: test `createWorkspace(brainPath, id, name, options?)` creates `workspaces/<id>.json`
   - RED: test `readWorkspace(brainPath, id)` returns Workspace
   - RED: test `updateWorkspaceState(brainPath, id, state)` modifies state fields
   - RED: test `updateWorkspaceLinks(brainPath, id, links)` modifies links
   - RED: test `linkArea(brainPath, id, area)` adds area to workspace.areas
   - RED: test `unlinkArea(brainPath, id, area)` removes area
   - RED: test `listWorkspaces(brainPath)` returns all workspaces
   - RED: test `archiveWorkspace(brainPath, id)` moves to `workspaces/archive/`
   - RED: test `getActiveWorkspace(brainPath)` / `setActiveWorkspace(brainPath, id)` — tracks which workspace is active via `workspaces/.active` file
   - GREEN: implement each
   - Table-driven tests for state update (phase only, active only, multiple fields)
   Commits: `test: workspace CRUD` → `feat: implement workspace storage`

3. **Journal.** File: `src/core/journal.ts`. Test: `tests/core/journal.test.ts`
   - RED: test `appendJournal(brainPath, workspaceId, text)` appends to `workspaces/<id>.journal.jsonl`
   - RED: test `readJournal(brainPath, workspaceId, limit?)` returns last N entries (default 5)
   - RED: test `readJournal` with empty journal returns empty array
   - GREEN: implement
   Commits: `test: journal append and read` → `feat: implement journal`

4. **Barrel exports.** Update `src/core/index.ts`.
   Commit: `feat: export workspace and journal modules`

**Deliverables:**
- `src/core/workspace.ts` — workspace CRUD + active workspace tracking
- `src/core/journal.ts` — journal append/read
- Updated `src/core/types.ts` — workspace types

**Tests:**
- Create workspace → file exists with correct structure
- Read workspace → returns correct data
- Update state → only specified fields change
- Link/unlink area → areas array modified
- List workspaces → returns all
- Archive → moved to archive/ subdirectory
- Active workspace → set/get persists across calls
- Journal append → new entry in JSONL
- Journal read with limit → returns last N
- Journal read empty → returns []

---

## Phase W2: CLI Commands

**Goal:** `kb work *` commands that exercise workspace core.

**SOLID focus:** Single Responsibility — each command is a thin wrapper. Dependency Inversion — commands receive workspace functions via the same core library.

**Pattern:** Same as Phase 5 CLI — parse args → call core → render output. No business logic in CLI.

**Development process:**

1. **Commands one at a time.** For each: RED: integration test via child_process. GREEN: implement in CLI.
   Priority order:
   - `kb work create <id> <name>` — flags: `--areas a1,a2`, `--jira`, `--wiki`, `--repos r1,r2`
   - `kb work start <id>` — set active workspace, print state + recent journal
   - `kb work stop` — clear active workspace
   - `kb work state` — flags: `--phase`, `--active`, `--blocked`, `--next`
   - `kb work journal "text"` — append entry
   - `kb work journal --show [N]` — show last N entries
   - `kb work link <area>` — link area to active workspace
   - `kb work unlink <area>` — unlink area
   - `kb work list` — list all workspaces with state summary
   - `kb work show [id]` — show full workspace details (default: active)
   - `kb work archive <id>` — archive workspace

2. **Error messages.** Test: no active workspace → helpful error. Unknown workspace → helpful error.

**Deliverables:**
- `src/cli/commands/work.ts` — all `kb work` subcommands

**Tests:**
- `kb work create test-ws "Test Workspace" --areas networking` → creates workspace JSON
- `kb work start test-ws` → sets active, prints state
- `kb work state --phase "building"` → updates phase
- `kb work journal "did some work"` → appends entry
- `kb work journal --show 3` → shows last 3
- `kb work list` → shows workspace with state
- `kb work archive test-ws` → moved to archive
- Error: `kb work state` without active workspace → error message

**Demo:**
```bash
kb work create stark "Stark Picking Dashboard" --areas stark,infra-vm --jira STARK-653
kb work start stark
kb work state --phase "server-setup" --active "M2 app installation"
kb work journal "Set up Ansible repo, applied base role to dev VM"
kb work show
kb work list
kb work stop
```

---

## Phase W3: Pi Extension Integration

**Goal:** Workspaces integrate with mykb's Pi extension — session start pre-loads workspace context, tools let the AI update state and journal.

**SOLID focus:** Open/Closed — workspace hooks extend the existing session hooks without modifying them. Interface Segregation — workspace tools depend only on workspace core, not on the knowledge store.

**Pattern:** Observer — workspace hooks subscribe to the same Pi events alongside existing hooks. Strategy — workspace context injection is a new signal source for the scorer (linked areas get boosted).

**Development process:**

1. **Session start workspace loading.** Extend `session_start` handler:
   - Check for active workspace (read `.active` file)
   - If active: read workspace JSON, read last 3 journal entries
   - Inject workspace state + journal as system message
   - Add linked areas to state's sticky set (scorer boost)
   Commit: `test: session start loads workspace` → `feat: workspace context on session start`

2. **Session shutdown workspace save.** Extend `session_shutdown`:
   - If active workspace: update workspace `updated` timestamp
   Commit: `test: session shutdown saves workspace` → `feat: auto-save workspace on shutdown`

3. **Registered tools.**
   - `kb_work_state` — AI can update phase/active/blocked/next during a session
   - `kb_work_journal` — AI can append journal entries
   Commit per tool: `test: kb_work_state tool` → `feat: implement kb_work_state`

4. **Scorer pre-seeding.** Modify scorer to boost scores for areas linked to the active workspace:
   - When workspace is active, linked areas get a base score boost (e.g., +0.5)
   - This ensures Tier 2 injects facts from linked areas even without explicit signals
   Commit: `test: scorer workspace boost` → `feat: boost linked areas in scorer`

5. **Rebuild bundle.** Rebuild esbuild bundle + container npm install for testing.

**Unit tests:**
- Session start with active workspace → injects state + journal
- Session start without workspace → no change (existing behavior)
- kb_work_state tool updates workspace state
- kb_work_journal tool appends journal entry
- Scorer with workspace boost → linked areas score higher

**LLM acceptance tests via vfa:**
```bash
# Setup: create workspace and seed knowledge
MYKB_DIR=/tmp/mykb-ws-test kb work create stark "Stark Dashboard" --areas networking
MYKB_DIR=/tmp/mykb-ws-test kb work start stark
MYKB_DIR=/tmp/mykb-ws-test kb work state --phase "server-setup" --active "VM provisioning"
MYKB_DIR=/tmp/mykb-ws-test kb work journal "Previous session: set up base role"
MYKB_DIR=/tmp/mykb-ws-test kb add fact networking "DNS uses CoreDNS" --source "docs"

# Test W3.1: AI knows the workspace context at session start
vfa run --provider pi --profile mykb-dev \
  --prompt "What am I currently working on? What phase am I in?"
# Expected: AI mentions "Stark Dashboard", "server-setup", "VM provisioning"

# Test W3.2: AI can update workspace state
vfa run --provider pi --profile mykb-dev \
  --prompt "Update the workspace phase to 'deployment' and set active to 'deploying app to test server'"
# Expected: AI uses kb_work_state tool

# Test W3.3: AI can journal
vfa run --provider pi --profile mykb-dev \
  --prompt "Add a journal entry: completed VM provisioning, moving to deployment"
# Expected: AI uses kb_work_journal tool

# Test W3.4: Linked areas are pre-loaded (scorer boost)
vfa run --provider pi --profile mykb-dev \
  --prompt "What DNS setup do we use?"
# Expected: AI answers from networking area (boosted because workspace links to it)
```

---

## Phase Summary

| Phase | What | Depends on | Unit tests | Integration tests | LLM acceptance tests |
|-------|------|-----------|-----------|------------------|---------------------|
| W1 | Workspace core (CRUD, journal) | mykb core (types, config) | yes | — | — |
| W2 | CLI commands (`kb work *`) | W1 | — | yes | — |
| W3 | Pi extension (context, tools, scorer) | W1, mykb extension | yes | — | yes |

## Milestones

**WM1: Workspace core (Phase W1)**
Storage works. Workspaces can be created, read, updated, archived. Journal entries can be appended and read.

**WM2: CLI works (Phase W2)**
Full `kb work` command set. User can manage workspaces from the terminal.

**WM3: Pi integration (Phase W3)**
The AI knows your workspace context at session start, can update state and journal, and gets linked area knowledge automatically. This is the full workspace experience.
