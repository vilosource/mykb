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
**LLM gate (Phase W3 only):** AI uses workspace tools correctly, context pre-loads on session start.

**Workspace-specific guardrails** (see [workspaces-design-guardrails.md](workspaces-design-guardrails.md) for full rationale):
- [ ] No `import fs` in workspace consumers — only `FileSystemWorkspaceStorage` touches the filesystem
- [ ] No hardcoded workspace paths (`workspaces/`, `workspace.json`, `journal.jsonl`, `.active`) outside `FileSystemWorkspaceStorage`
- [ ] No git operations inside `WorkspaceStorage` — git stays in `save.ts`
- [ ] `updateWorkspaceState` uses `Partial<WorkspaceState>` — never overwrites unrelated fields
- [ ] `archiveWorkspace` preserves data (moves to archive/), never deletes
- [ ] Single `WorkspaceStorage` instance created in extension entry point, passed to all hooks and tools via DI
- [ ] Active workspace accessed only via `getActiveWorkspaceId()` / `setActiveWorkspaceId()` / `clearActiveWorkspaceId()`
- [ ] Journal accessed only via `appendJournal()` / `readJournal()` on the interface

## Agent Workflow

Each phase is delegated to a subagent. The main agent (me) manages the flow.

**Process per phase:**
1. Launch subagent with phase requirements on a feature branch (`phase-w1-*`, `phase-w2-*`, `phase-w3-*`)
2. Wait for completion notification
3. Checkout branch, run `npm test`, review code
4. Run phase gate checklist (code + TDD + guardrails)
5. If gate passes: merge to develop, delete branch, launch next phase
6. If gate fails: fix issues or re-run agent

**Sequential only.** No parallel phases — previous mykb build showed parallel agents fighting over the same working directory, causing stray commits and merge conflicts.

**Agent prompt must include:**
- `cd /home/jasonvi/GitHub/mykb` at the START of every bash command (shell resets CWD between calls)
- Git user: `vilosource` / `vilosource@users.noreply.github.com` (verify and fix)
- `--registry https://registry.npmjs.org --userconfig /dev/null` for any npm operations
- List of files to read before coding (existing source the agent depends on)
- No AI attribution in commits
- Branch workflow: checkout develop → pull → create feature branch → work → push (do NOT merge)

**After Phase W3:**
1. Rebuild esbuild bundle: `npx esbuild src/extension/index.ts --bundle --platform=node --format=esm --outfile=dist/bundle/index.js --external:better-sqlite3 --target=esnext --legal-comments=none`
2. Rebuild container deps: `docker run --rm -v dist/bundle:/ext -w /ext ghcr.io/vilosource/vf-agents-pi:latest npm install --registry https://registry.npmjs.org`
3. Run LLM acceptance tests via vfa (Phase W3 tests + end-to-end user journey)

## Test Isolation

All tests use `withTempBrain`. Workspace files live inside the brain directory at `workspaces/`.

---

## Phase W1: Workspace Core — Types, Storage, CRUD

**Goal:** Create, read, update, list, archive workspaces. Append and read journal entries.

**SOLID focus:** Single Responsibility — `workspace.ts` handles all workspace storage operations (CRUD, journal, documents). Dependency Inversion — define `WorkspaceStorage` interface FIRST, then implement `FileSystemWorkspaceStorage`. Interface Segregation — workspace operations don't depend on knowledge store.

**Pattern:** Repository — `FileSystemWorkspaceStorage` implements `WorkspaceStorage` interface. All filesystem access (`fs.*`, path construction, directory creation) is encapsulated inside this class. No consumer ever imports `fs` or constructs workspace paths.

**Guardrails enforced in this phase:**
- Interface defined before implementation (Guardrail: DI)
- All `fs` operations inside `FileSystemWorkspaceStorage` only (Guardrail 1)
- All path construction inside `FileSystemWorkspaceStorage` only (Guardrail 2)
- No git operations in workspace storage (Guardrail 6)
- `updateWorkspaceState` accepts `Partial<WorkspaceState>` (Guardrail 7)
- `archiveWorkspace` moves, never deletes (Guardrail 8)

**Development process:**

1. **Types and interface.** Add to `src/core/types.ts`:
   - `WorkspaceState`: `{ phase?, active?, blocked?, next? }` (all optional for partial updates)
   - `WorkspaceLinks`: `{ jira?, wiki?, repos? }`
   - `WorkspaceDocument`: `{ path, description: string | null }`
   - `Workspace`: `{ id, name, state, areas, links, documents, created, updated }`
   - `JournalEntry`: `{ date, text }`
   - `WorkspaceStorage` interface — the abstraction that all consumers depend on:
     ```typescript
     interface WorkspaceStorage {
       // Workspace CRUD
       createWorkspace(id: string, name: string, options?: CreateWorkspaceOptions): void;
       readWorkspace(id: string): Workspace | null;
       updateWorkspaceState(id: string, state: Partial<WorkspaceState>): void;
       updateWorkspaceLinks(id: string, links: Partial<WorkspaceLinks>): void;
       linkArea(id: string, area: string): void;
       unlinkArea(id: string, area: string): void;
       listWorkspaces(): Workspace[];
       archiveWorkspace(id: string): void;

       // Active workspace
       getActiveWorkspaceId(): string | null;
       setActiveWorkspaceId(id: string): void;
       clearActiveWorkspaceId(): void;

       // Journal
       appendJournal(id: string, text: string): void;
       readJournal(id: string, limit?: number): JournalEntry[];

       // Documents
       writeDocument(id: string, path: string, content: string): void;
       readDocument(id: string, path: string): string | null;
       listDocuments(id: string): WorkspaceDocument[];
       deleteDocument(id: string, path: string): void;
       scanDocumentIndex(id: string): WorkspaceDocument[];
       updateDocumentIndex(id: string): void;
     }
     ```
   - `CreateWorkspaceOptions`: `{ areas?, links? }`

   This interface enables future storage backends (Azure Blob, S3, NFS) without changing consumers. Today: `FileSystemWorkspaceStorage`. Tomorrow: swap the implementation.

   Commit: `feat: add workspace types and WorkspaceStorage interface`

2. **FileSystemWorkspaceStorage.** File: `src/core/workspace.ts`. Test: `tests/core/workspace.test.ts`
   Implements `WorkspaceStorage` interface using the filesystem at `~/.mykb/workspaces/`.
   Constructor takes `brainPath`.

   - RED: test `createWorkspace(id, name, options?)` creates `workspaces/<id>/workspace.json`
   - RED: test `readWorkspace(id)` returns Workspace
   - RED: test `updateWorkspaceState(id, state)` modifies state fields
   - RED: test `updateWorkspaceLinks(id, links)` modifies links
   - RED: test `linkArea(id, area)` adds area to workspace.areas
   - RED: test `unlinkArea(id, area)` removes area
   - RED: test `listWorkspaces()` returns all workspaces
   - RED: test `archiveWorkspace(id)` moves to `workspaces/archive/`
   - RED: test `getActiveWorkspaceId()` / `setActiveWorkspaceId(id)` / `clearActiveWorkspaceId()` — tracks via `workspaces/.active` file
   - RED: test `updateWorkspaceState` with partial state — updating only `phase` preserves `active`, `blocked`, `next`
   - RED: test `createWorkspace` auto-creates `workspaces/` directory if it doesn't exist
   - RED: test `readWorkspace` when linked area doesn't exist in mykb — returns workspace normally (area existence is not validated at read time)
   - GREEN: implement each
   - Table-driven tests for state update (phase only, active only, multiple fields)
   Commits: `test: workspace CRUD` → `feat: implement FileSystemWorkspaceStorage`

3. **Journal (part of FileSystemWorkspaceStorage).**
   - RED: test `appendJournal(id, text)` appends to `workspaces/<id>/journal.jsonl`
   - RED: test `readJournal(id, limit?)` returns last N entries (default 5)
   - RED: test `readJournal` with empty journal returns empty array
   - GREEN: implement
   Commits: `test: journal append and read` → `feat: implement journal`

4. **Workspace rendering.** File: `src/core/render.ts` (extend). Test: `tests/core/render.test.ts` (extend)
   - RED: test `renderWorkspace(workspace, journalEntries)` produces formatted output:
     ```
     # My Project (my-project)
     Phase: building | Active: setting up CI | Blocked: none | Next: deploy to staging
     Areas: networking, ci-pipelines
     Links: JIRA STARK-653 | Wiki: https://...

     ## Recent Journal
     - 2026-03-15: Previous session: configured DNS
     - 2026-03-14: Set up CI pipeline
     ```
   - GREEN: implement
   Commits: `test: workspace rendering` → `feat: implement renderWorkspace`

5. **Document index scanning (part of FileSystemWorkspaceStorage).**
   - RED: test `scanDocumentIndex(id)` finds all `.md` files in workspace directory (excluding `workspace.json` and `journal.jsonl`), reads frontmatter `description` field, returns `WorkspaceDocument[]`
   - RED: test with no docs → returns empty array
   - RED: test with doc missing frontmatter → `description: null`
   - RED: test with doc having frontmatter → extracts description
   - GREEN: implement. Scan recursively, read first 10 lines, parse YAML between `---` delimiters.
   - RED: test `updateDocumentIndex(id)` calls `scanDocumentIndex` and writes result to `workspace.json` `documents` field
   - GREEN: implement. Called by `kb save`.
   Commits: `test: document index scanning` → `feat: implement workspace document index`

6. **Barrel exports.** Update `src/core/index.ts`.
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
- Active workspace → set/get/clear persists across calls
- Create workspace auto-creates workspaces/ directory
- Partial state update → only specified fields change, others preserved
- Render workspace → formatted markdown output including document list
- Document scan with frontmatter → extracts description
- Document scan without frontmatter → description is null
- Document scan empty workspace → empty array
- updateDocumentIndex → writes documents to workspace.json
- Journal append → new entry in JSONL
- Journal read with limit → returns last N
- Journal read empty → returns []

---

## Phase W2: CLI Commands

**Goal:** `kb work *` commands that exercise workspace core.

**SOLID focus:** Single Responsibility — each command is a thin wrapper. Dependency Inversion — commands receive a `WorkspaceStorage` instance, never import `FileSystemWorkspaceStorage` directly.

**Pattern:** Same as Phase 5 CLI — parse args → call storage interface → render output. No business logic in CLI.

**Guardrails enforced in this phase:**
- Commands receive `WorkspaceStorage`, never construct it or import concrete class (Guardrail 1, 2)
- Commands call `storage.getActiveWorkspaceId()`, never read `.active` file (Guardrail 4)
- `kb work state` passes partial state object to `storage.updateWorkspaceState()` (Guardrail 7)
- `kb work journal` calls `storage.appendJournal()`, never writes JSONL directly (Guardrail 5)
- Verification: grep `src/cli/commands/work.ts` for `import fs`, `readFileSync`, `writeFileSync`, `workspaces/`, `.active` — must find zero hits

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

**SOLID focus:** Open/Closed — workspace hooks extend the existing session hooks without modifying them. Dependency Inversion — workspace tools and hooks depend on `WorkspaceStorage` interface, not `FileSystemWorkspaceStorage`. Interface Segregation — workspace tools don't depend on the knowledge store.

**Pattern:** Observer — workspace hooks subscribe to the same Pi events alongside existing hooks. Strategy — workspace context injection is a new signal source for the scorer (linked areas get boosted).

**Guardrails enforced in this phase:**
- Extension entry point creates ONE `FileSystemWorkspaceStorage` instance, passes to all hooks and tools (Guardrail 9)
- Hooks and tools type their parameter as `WorkspaceStorage`, never `FileSystemWorkspaceStorage` (Guardrail 1)
- Session start reads active workspace via `storage.getActiveWorkspaceId()`, never reads `.active` file (Guardrail 4)
- Session start reads journal via `storage.readJournal()`, never reads JSONL directly (Guardrail 5)
- `kb_work_state` tool calls `storage.updateWorkspaceState()` with partial state (Guardrail 7)
- `kb_work_journal` tool calls `storage.appendJournal()` (Guardrail 5)
- Document creation: AI uses Pi's native `write` tool to create docs in workspace directory. Index updated on `kb save` via `storage.updateDocumentIndex()`. No `kb_write_doc` tool needed for filesystem backend (Guardrail 3 from design guardrails)
- Verification: grep extension and tools files for `import fs`, `readFileSync`, `writeFileSync`, `workspaces/`, `.active`, `journal.jsonl` — must find zero hits

**Development process:**

1. **Session start workspace loading.** Extend `session_start` handler:
   - Check for active workspace (read `.active` file)
   - If active: read workspace JSON, read last 3 journal entries
   - Inject workspace state + journal as system message
   - Add linked areas to state's sticky set (scorer boost)
   Commit: `test: session start loads workspace` → `feat: workspace context on session start`

2. **Session shutdown workspace save.** Extend `session_shutdown`:
   - If active workspace: update workspace `updated` timestamp, call `kb save`
   - Journal entries are NOT auto-generated at shutdown — the AI writes them explicitly during the session via `kb_work_journal` tool. This avoids the OSB v1 problem where the Stop hook forced an AI-generated summary that was often low quality.
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

## End-to-End User Journey Test

After all 3 phases are merged and the bundle is rebuilt, run this full workflow to verify the real user experience across multiple sessions.

### Setup

```bash
# Build first
cd ~/GitHub/mykb && npm run build

# Seed knowledge areas (use node dist/cli/cli.js since kb may not be on PATH)
export MYKB_DIR=/tmp/mykb-e2e
node dist/cli/cli.js init
node dist/cli/cli.js add fact networking "DNS uses CoreDNS with zone forwarding" --source "docs"
node dist/cli/cli.js add gotcha networking "NAT has asymmetric routing" --source "debugging"
node dist/cli/cli.js add fact ci-pipelines "Runners use spot instances" --source "cloud-console"

# Create and activate workspace
node dist/cli/cli.js work create myproject "My Project" --areas networking,ci-pipelines
node dist/cli/cli.js work start myproject
node dist/cli/cli.js work state --phase "building" --active "setting up CI"
node dist/cli/cli.js work journal "Previous session: configured DNS"
node dist/cli/cli.js save
unset MYKB_DIR
```

### Session 1: Context loading + knowledge access + state mutation

```bash
vfa session start --provider pi --profile mykb-dev \
  --prompt "What am I working on right now?"
# Expected: AI knows "My Project", phase "building", active "setting up CI"

vfa session send --prompt "What DNS setup do we use?"
# Expected: answers "CoreDNS with zone forwarding" from linked networking area

vfa session send --prompt "Are there any known issues with NAT?"
# Expected: mentions asymmetric routing gotcha

vfa session send --prompt "Update the phase to 'testing' and active to 'running integration tests'"
# Expected: AI uses kb_work_state tool

vfa session send --prompt "Add a journal entry: set up CI pipeline with spot runners"
# Expected: AI uses kb_work_journal tool

vfa session close
# Expected: workspace auto-saved
```

### Session 2: Persistence across sessions

```bash
vfa session start --provider pi --profile mykb-dev \
  --prompt "What phase am I in? What did I do last session?"
# Expected: phase is "testing", journal shows both entries

vfa session close
```

### What this verifies

| Concern | Verified by |
|---------|-------------|
| Workspace context loads on session start | Session 1, first prompt |
| Linked area knowledge available via Tier 2 boost | Session 1, DNS and NAT prompts |
| AI can update workspace state via tools | Session 1, phase update prompt |
| AI can append journal via tools | Session 1, journal prompt |
| State persists across sessions | Session 2, phase check |
| Journal accumulates across sessions | Session 2, journal check |
| Session end auto-saves | Session 2 seeing Session 1's changes |

### Results Template

| Step | Expected | Actual | Pass/Fail |
|------|----------|--------|-----------|
| S1.1 What am I working on? | "My Project", phase "building" | | |
| S1.2 DNS setup? | "CoreDNS with zone forwarding" | | |
| S1.3 NAT issues? | "asymmetric routing" | | |
| S1.4 Update phase | Uses kb_work_state | | |
| S1.5 Add journal | Uses kb_work_journal | | |
| S2.1 What phase? What last session? | "testing", both journal entries | | |
