# mykb Implementation Plan — Draft

Parent: [design-status.md](design-status.md) | Manifesto: [development-MANIFESTO.md](development-MANIFESTO.md)

## Approach

Bottom-up implementation. Each phase produces something testable and demonstrable. No phase depends on unreleased work from a later phase. Every phase follows the TDD manifesto: failing test first, then implementation.

## Testing Layers

Every phase has up to three testing layers:

| Layer | What it tests | How | Who runs it |
|-------|--------------|-----|-------------|
| **Unit tests** | Code correctness — functions return expected values, errors thrown correctly | Vitest with mocks/fixtures | `npm test` (automated) |
| **Integration tests** | Components wired correctly — CLI commands produce correct output and side effects | Vitest invoking real CLI + real JSONL/SQLite on temp dirs | `npm test` (automated) |
| **LLM acceptance tests** | AI experience — does the AI actually use the knowledge, follow the redirect, answer correctly? | `vfa run` / `vfa session` with prompted scenarios, verify AI response content | Manual via vfa (human reviews result) |

**LLM acceptance tests are not optional.** mykb's user is an AI. Unit tests verify the plumbing works. LLM tests verify the AI experience works. These catch things unit tests cannot:
- Does the rendered markdown format work well for LLM consumption?
- Does the AI actually USE injected context or ignore it?
- Does the tool description make the AI choose the right tool?
- Does the block reason redirect the AI effectively?
- Does the AI understand the area summaries in Tier 1?

LLM acceptance tests use `vfa run --provider pi --profile mykb-dev` and verify the `result` field in the JSON output contains the expected knowledge. They are run manually after each phase that touches the Pi extension or output formatting.

## Phase Gates

Before moving to the next phase, every phase must pass this checklist. No exceptions.

**Code gate:**
- [ ] All tests pass (`npm test`)
- [ ] No `any` types in new code
- [ ] Every public function has a test
- [ ] Interfaces defined before implementations
- [ ] Dependencies injected, not hardcoded
- [ ] Error cases handled with domain-specific error classes
- [ ] No dead code

**TDD gate:**
- [ ] Git log shows RED → GREEN → REFACTOR commit sequence
- [ ] No implementation commits without a preceding test commit
- [ ] Test names describe behavior, not implementation

**LLM gate (phases 6+ only):**
- [ ] All LLM acceptance tests pass via vfa
- [ ] AI uses tools correctly without explicit instruction
- [ ] No extension errors in container stderr

## Test Isolation

All tests use temporary directories for the brain. Never touch real `~/.mykb/`.

```typescript
// test helper pattern
function withTempBrain(fn: (brainPath: string) => Promise<void>) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mykb-test-'));
  process.env.MYKB_DIR = tmpDir;
  try {
    await fn(tmpDir);
  } finally {
    process.env.MYKB_DIR = undefined;
    fs.rmSync(tmpDir, { recursive: true });
  }
}
```

Integration tests (CLI) set `MYKB_DIR` to a temp directory before invoking commands. This is the same pattern as vfa's `VFA_HOME` override.

## vfa Profiles

Two profiles for development:

| Profile | Mounts | Use |
|---------|--------|-----|
| `mykb-spike` | `spikes/active-spike/` → Pi extensions | Spike experiments (already exists) |
| `mykb-dev` | `dist/extension/` → Pi extensions, `~/.mykb/` → brain data | Real implementation testing (phases 6+) |

`mykb-dev` profile must be created before Phase 6 starts. It mounts both the compiled extension AND the brain data volume (read-write):

```yaml
# ~/.vf-agents/profiles/mykb-dev.yaml
id: mykb-dev
description: "Profile for testing mykb Pi extension (real implementation)"
compatible_runtimes: [pi]
workspace:
  type: ephemeral
  mount_path: /workspace
mode: headless
output_format: json
timeout: 60
plugins:
  pi:
    - source: /home/jasonvi/GitHub/mykb/dist/extension
      mount: /home/node/.pi/agent/extensions/mykb
    - source: /home/jasonvi/.mykb
      mount: /home/node/.mykb
```

Without the brain mount, the extension has no knowledge data to read or write.

## Error Classes

Defined in Phase 1 (`src/core/errors.ts`), used from Phase 2 onward:

| Error | When |
|-------|------|
| `BrainNotInitializedError` | Brain directory doesn't exist and auto-init is not enabled |
| `AreaNotFoundError` | Area ID doesn't exist (when auto-create is not applicable) |
| `EntryNotFoundError` | Entry ID doesn't exist in the area |
| `EntryValidationError` | Invalid entry data (missing required fields, bad type) |
| `StoreCorruptionError` | Malformed JSONL line or inconsistent state |
| `DatabaseError` | SQLite operation failed |

## CLI Arg Parser

Phase 5 uses **commander** (`commander` npm package) for argument parsing. Reasons:
- Most popular TypeScript CLI framework
- Declarative command/option definitions
- Auto-generated help text
- Subcommand support (`kb add fact`, `kb area update`)

## CI

Phase 0 includes a GitHub Actions workflow (`.github/workflows/ci.yml`):
- Trigger: push to develop, pull requests
- Steps: install → lint → build → test
- Node.js 20

---

## Phase 0: Project Scaffold

**Goal:** Empty project that builds, lints, and runs tests.

**Deliverables:**
- `package.json` with dependencies (better-sqlite3, nanoid, vitest, commander)
- `tsconfig.json` (strict mode, ESM)
- Directory structure: `src/core/`, `src/cli/`, `src/extension/`, `src/tools/`
- Vitest config with test isolation helper (`withTempBrain`)
- `.gitignore` (node_modules, dist, *.db)
- Lint config (eslint + prettier with strict rules)
- `.github/workflows/ci.yml` — lint → build → test on push/PR
- Test helper utilities (`tests/helpers.ts`)

**Tests:** `npm test` runs and passes (1 placeholder test). CI runs on push.

**Demo:** `npm run build` produces `dist/`.

---

## Phase 1: Core Types + Config

**Goal:** Type definitions and brain location resolution.

**SOLID focus:** Interface Segregation + Dependency Inversion — define ALL interfaces before any implementation exists. These interfaces are the contracts that every subsequent phase depends on.

**Development process:**
1. **Interfaces first (no implementation).** Write `KnowledgeStore`, `SearchEngine`, `EntryFilter` interfaces in `types.ts`. These define the contracts for Phases 2-4. Commit: `feat: define core interfaces`
2. **Types and enums.** Define `KnowledgeEntry`, `FactEntry`, `DecisionEntry`, `GotchaEntry`, `PatternEntry`, `LinkEntry`, `Provenance`, `ProvenanceStatus`, `Zone`, `AreaMetadata`, `ManifestFile`. Commit: `feat: define domain types`
3. **Error classes.** RED: write tests that construct each error and verify name/message. GREEN: implement error classes. Commit: `test: error class construction` → `feat: implement domain errors`
4. **Config.** RED: write tests for `resolveBrainPath` with/without env var, `brainExists` with existing/missing dir. GREEN: implement. Commit: `test: brain path resolution` → `feat: implement config`
5. **ID generation.** RED: test nanoid produces 8-char alphanumeric. GREEN: implement wrapper. Commit: `test: nanoid generation` → `feat: implement id generator`

**Deliverables:**
- `src/core/types.ts` — all interfaces and types
- `src/core/config.ts` — brain location resolution
- `src/core/id.ts` — nanoid generation wrapper
- `src/core/errors.ts` — domain-specific error classes

**Tests:**
- Type validation (compile-time)
- Each error class has correct name and message format
- `resolveBrainPath` with/without env var (table-driven: 3 cases)
- `brainExists` with existing/missing directory
- nanoid generation produces 8-char alphanumeric strings, uniqueness across 100 calls

---

## Phase 2: JSONL Store

**Goal:** Read and write knowledge entries to JSONL files.

**SOLID focus:** Single Responsibility — `store.ts` does JSONL I/O only. `area.ts` does area metadata only. `manifest.ts` does index generation only. Three files, three responsibilities.

**Pattern:** Repository — `store.ts` is the first concrete implementation behind the `KnowledgeStore` interface's read/write methods (the facade in Phase 4 will compose it with the DB).

**Development process:**
1. **Store — append.** RED: test that `appendEntry` creates JSONL file and writes one line. GREEN: implement. Use `withTempBrain` for test isolation. Commit: `test: appendEntry` → `feat: implement appendEntry`
2. **Store — read.** RED: test that `readEntries` returns appended entry. Then test latest-wins with same ID. Then test tombstone exclusion. GREEN: implement each. Table-driven tests for the 3 cases. Commit: `test: readEntries cases` → `feat: implement readEntries`
3. **Store — compact.** RED: test compact collapses versions and removes tombstones. Test idempotency. GREEN: implement. Commit: `test: compactEntries` → `feat: implement compactEntries`
4. **Store — malformed lines.** RED: test that malformed JSON line is skipped (logged, not crashed). GREEN: implement. Commit: `test: malformed JSONL handling` → `feat: handle malformed lines`
5. **Area — CRUD.** RED: test `createArea`, `readAreaMetadata`, `updateAreaMetadata`, `listAreas`, `areaExists`, `deleteArea`. GREEN: implement each. `deleteArea` removes directory + all JSONL files + regenerates manifest. Commit: `test: area CRUD` → `feat: implement area management`
6. **Manifest.** RED: test `regenerateManifest` produces correct JSON from area.json files. Test `readManifest`. GREEN: implement. Commit: `test: manifest generation` → `feat: implement manifest`
7. **Auto-create.** RED: test that `appendEntry` to non-existent area creates the area directory first. GREEN: implement. Commit: `test: auto-create area on write` → `feat: auto-create area`

**Deliverables:**
- `src/core/store.ts` — JSONL operations (append, read, tombstone, compact)
- `src/core/area.ts` — area management (create, read, update, list, exists, delete)
- `src/core/manifest.ts` — manifest generation (regenerate, read)

**Tests (all use `withTempBrain`):**
- Append entry → read it back → matches
- Append two entries with same ID → readEntries returns latest only
- Tombstone → entry disappears from readEntries
- Create area → directory + area.json exist
- List areas → returns all area metadata
- Regenerate manifest → matches area.json contents
- Auto-create area directory on first write
- Handle malformed JSONL lines (skip, don't crash)
- Compact → JSONL has only latest version per ID, no tombstones
- Compact is idempotent — running twice produces same result

---

## Phase 3: SQLite + FTS5

**Goal:** Query cache with full-text search, hydration from JSONL.

**SOLID focus:** Single Responsibility — `db.ts` does SQLite queries. `hydrate.ts` does JSONL→SQLite sync. Interface Segregation — `db.ts` implements `SearchEngine` interface from Phase 1 (only the search methods, not the write methods).

**Pattern:** Factory — `createDatabase()` handles schema creation, WAL mode, FTS5 setup. Callers receive a ready-to-use database object.

**Development process:**
1. **Schema creation.** RED: test `createDatabase` produces tables with correct columns, WAL enabled. GREEN: implement with full SQL from design doc. Commit: `test: database schema creation` → `feat: implement createDatabase`
2. **Entry CRUD.** RED: test upsert → query, upsert same ID → latest wins, delete → gone. Table-driven. GREEN: implement. Commit: `test: entry CRUD` → `feat: implement entry operations`
3. **FTS5 search.** RED: seed entries, test `searchEntries("keyword")` returns matches ranked by BM25. Test empty results. GREEN: implement. Commit: `test: FTS5 search` → `feat: implement searchEntries`
4. **Query filters.** RED: test `queryEntries` with area, type, zone, tags, provenance status filters. Table-driven with multiple filter combinations. GREEN: implement. Commit: `test: query filters` → `feat: implement queryEntries`
5. **Area metadata.** RED: test `upsertArea`, `listAreas`, `getAreaStats`. GREEN: implement. Commit: `test: area metadata` → `feat: implement area operations`
6. **Hydration.** RED: seed JSONL files in temp brain, test `hydrateDatabase` populates SQLite correctly (including tombstone handling). GREEN: implement. Commit: `test: hydration` → `feat: implement hydrateDatabase`
7. **Staleness.** RED: test `isStale` returns true/false based on file mtime vs timestamp. Test `ensureFresh` skips when current, rebuilds when stale. GREEN: implement. Commit: `test: stale detection` → `feat: implement staleness checks`

**Deliverables:**
- `src/core/db.ts` — SQLite interface (implements `SearchEngine`)
- `src/core/hydrate.ts` — JSONL → SQLite rebuild + staleness detection

**Tests (all use in-memory SQLite or temp file):**
- Create database → schema exists, WAL enabled
- Upsert entry → query returns it
- Upsert same ID twice → latest wins
- Delete entry → query returns nothing
- FTS5 search → returns matching entries ranked by relevance
- FTS5 search for non-existent term → empty results
- Query filters: by area, type, zone, tag, provenance (table-driven)
- Hydrate from JSONL → all entries in SQLite
- Hydrate with tombstones → deleted entries absent
- isStale returns true after JSONL modification
- isStale returns false when cache is current
- Area stats return correct counts per type

---

## Phase 4: Core Library Facade

**Goal:** High-level API that wires store + db together with dual-write.

**SOLID focus:** Dependency Inversion — the facade receives `store` and `db` as constructor parameters (injected, not created internally). Open/Closed — new knowledge types can be added without modifying existing add methods. Single Responsibility — `knowledge-store.ts` orchestrates dual-write, `render.ts` formats output, `init.ts` handles brain setup, `save.ts` handles git.

**Pattern:** Facade — `knowledge-store.ts` exposes a simple API (`addFact`, `loadArea`, `search`) that hides the JSONL→SQLite dual-write complexity from callers. Null Object — missing brain returns empty results from read operations instead of throwing (when auto-init is possible).

**Development process:**
1. **Facade constructor.** Define `JsonlSqliteStore` class that takes store + db as constructor parameters. No implementation yet — just the wiring. Commit: `feat: facade constructor with DI`
2. **Add operations.** RED: test `addFact` writes to both JSONL and SQLite. Verify entry exists in both after add. GREEN: implement dual-write. Repeat for `addDecision`, `addGotcha`, `addPattern`, `addLink`. Commit per type: `test: addFact dual-write` → `feat: implement addFact`
3. **Auto-create area.** RED: test `addFact` to non-existent area creates it first. GREEN: implement area check + creation. Commit: `test: auto-create area in facade` → `feat: auto-create area on add`
4. **Update/delete/verify/promote/archive.** RED: test each mutation. GREEN: implement. Each mutation appends to JSONL and updates SQLite. Commit per operation.
5. **Read operations.** RED: test `loadArea`, `search`, `matchAreas`. GREEN: implement (delegate to db). Commit per operation.
6. **Render.** RED: test `renderMarkdown` produces expected format (from design doc). Test `renderContextBlock` wraps in `<mykb-context>` tags. Test `renderAreaIndex` for Tier 1. GREEN: implement. Commit: `test: render markdown format` → `feat: implement renderers`
7. **Init + dirty shutdown.** RED: test `initBrain` creates correct structure. Test `isDirtyShutdown` detects uncommitted files. Test `recoverDirtyShutdown` commits them. GREEN: implement. Commit per function.
8. **Save.** RED: test `save` creates git commit. Test `saveAndPush`. GREEN: implement. Commit: `test: git save` → `feat: implement save`

**Deliverables:**
- `src/core/knowledge-store.ts` — implements `KnowledgeStore` interface:
  - `addFact(area, text, options)` → dual-write (JSONL + SQLite), return ID
  - `addDecision(area, text, options)` → dual-write, return ID
  - `addGotcha(area, text, options)` → dual-write, return ID
  - `addPattern(area, text, options)` → dual-write, return ID
  - `addLink(area, text, url, options)` → dual-write, return ID
  - `updateEntry(area, id, updates)` → append new JSONL line, UPSERT SQLite
  - `deleteEntry(area, id)` → tombstone JSONL, DELETE SQLite
  - `verifyEntry(area, id)` → refresh provenance date
  - `promoteEntry(area, id)` → change zone active → established
  - `archiveEntry(area, id)` → change zone → archive
  - `loadArea(area, filter?)` → query SQLite with optional filter
  - `search(query)` → FTS5 search
  - `matchAreas(text)` → FTS5 across areas, group + rank by area
  - `compact(area?)` → call store.compactEntries, rebuild SQLite FTS5 index
- `src/core/render.ts` — output formatting:
  - `renderMarkdown(entries)` → compact markdown for LLM consumption
  - `renderJson(entries)` → JSON output
  - `renderContextBlock(areaEntries)` → `<mykb-context>` wrapped markdown for Tier 2 injection
  - `renderAreaIndex(areas)` → compact area summaries for Tier 1 system prompt

  Markdown format (from design doc):
  ```markdown
  ## area-name (Active)
  - fact text #tag1 #tag2 (verified:2026-03-15)
  - another fact (unverified)
  ```

  Context block format:
  ```markdown
  <mykb-context>
  ## area-name
  - fact text #tag (verified:2026-03-15)
  </mykb-context>
  ```
- `src/core/init.ts` — brain initialization:
  - `initBrain(path)` → create directory, git init, .gitignore, empty manifest
  - `isDirtyShutdown(path)` → check for uncommitted JSONL changes
  - `recoverDirtyShutdown(path)` → auto-commit with recovery message
- `src/core/save.ts` — git operations:
  - `save(path, message?)` → git add + commit all tracked files
  - `saveAndPush(path, message?)` → commit + push

**Tests:**
- addFact → entry in both JSONL and SQLite
- addFact to non-existent area → auto-creates area + entry
- updateEntry → old text gone, new text queryable
- deleteEntry → tombstone in JSONL, absent from SQLite
- verifyEntry → provenance date refreshed
- promoteEntry → zone changes from active to established
- loadArea → returns all current entries for area
- loadArea with tag filter → returns only matching
- search → returns cross-area results ranked by relevance
- matchAreas → returns area IDs sorted by relevance score
- renderMarkdown → compact format with provenance annotations
- initBrain → creates directory structure + git repo
- isDirtyShutdown → detects uncommitted JSONL
- save → commits all changes with message

---

## Phase 5: CLI

**Goal:** Standalone `kb` command that exercises the full core library.

**SOLID focus:** Single Responsibility — each command file does one thing (parse args, call facade, format output). Dependency Inversion — commands receive the facade via dependency injection, not by importing concrete classes.

**Pattern:** Each command is a thin wrapper: parse args → call facade → render output. No business logic in CLI layer. If a command needs more than 5 lines of logic beyond arg parsing and facade calls, the logic belongs in the facade.

**Development process:**
1. **Entry point + help.** Set up commander with program name, version, description. Test `kb --help` outputs usage. Commit: `feat: CLI entry point`
2. **One command at a time.** For each command: RED: write integration test that invokes the CLI binary via child_process, asserts stdout/stderr and file side effects. GREEN: implement command. Example for `kb init`:
   - `test: kb init creates brain` → verify directory structure exists
   - `feat: implement kb init`
   - `test: kb init when brain exists` → verify error message
3. **Priority order.** Build commands in dependency order: `init` → `add` → `load` → `list` → `search` → `save` → maintenance → area → stats → stale → compact → rebuild → export
4. **Error messages.** RED: test each error case (missing brain, bad args, unknown area). GREEN: return clear error messages with exit code 1. Users (human and AI) read error output — it must be helpful.

**Deliverables:**
- `src/cli/cli.ts` — entry point, argument parsing
- `src/cli/commands/init.ts` — `kb init`, `kb init area`
- `src/cli/commands/add.ts` — `kb add fact|decision|gotcha|pattern|link`
- `src/cli/commands/update.ts` — `kb update`
- `src/cli/commands/load.ts` — `kb load` (markdown default, `--json`)
- `src/cli/commands/list.ts` — `kb list` (markdown default, `--json`)
- `src/cli/commands/search.ts` — `kb search`
- `src/cli/commands/match.ts` — `kb match`
- `src/cli/commands/maintenance.ts` — `kb verify`, `kb promote`, `kb archive`, `kb delete`
- `src/cli/commands/area.ts` — `kb area update`, `kb area delete`
- `src/cli/commands/save.ts` — `kb save`, `kb save --push`
- `src/cli/commands/stats.ts` — `kb stats`
- `src/cli/commands/stale.ts` — `kb stale`
- `src/cli/commands/compact.ts` — `kb compact`
- `src/cli/commands/rebuild.ts` — `kb rebuild`
- `src/cli/commands/export.ts` — `kb export agents-md`

Note: `kb import osb` is deferred to post-M5. Parsing OSB's markdown BRAIN.md in TypeScript is complex (frontmatter, provenance regex, zone headers, multi-line facts). Not needed for the core product.

**Tests:**
- Integration tests: invoke CLI commands, verify stdout + file side effects
- `kb init` → creates brain directory with correct structure
- `kb add fact test-area "fact text"` → entry appears in JSONL + queryable
- `kb load test-area` → renders markdown with facts
- `kb search "keyword"` → returns matching entries
- `kb save` → creates git commit
- `kb stats` → correct counts
- Error cases: missing brain, invalid area, bad arguments

**Demo:** Full CLI workflow in terminal:
```
kb init
kb add fact networking "DNS uses CoreDNS" --source "docs"
kb add gotcha networking "NAT has asymmetric routing" --source "debugging"
kb load networking
kb search "DNS"
kb save
```

---

## Phase 6: Pi Extension — Core Hooks

**Goal:** Extension loads in Pi, handles session lifecycle, registers basic tools.

**SOLID focus:** Dependency Inversion — hooks receive the facade and state via the extension's init function, not by importing globals. Single Responsibility — `session.ts` only handles lifecycle events, `state.ts` only tracks session state.

**Pattern:** Observer — hooks subscribe to Pi events. Each hook is an independent observer that reacts to one event type. Factory — the extension entry point (`index.ts`) is a factory that creates the facade, state, and wires hooks.

**Development process:**
1. **Extension entry point.** Create `index.ts` that exports the default function. Inside: resolve brain path → create facade → create state → register hooks. Commit: `feat: extension entry point`
2. **State.** RED: test state initializes with empty sets. GREEN: implement `SessionState` class. Commit: `test: session state` → `feat: implement state`
3. **Session start.** RED: test that session_start handler calls initBrain when brain missing. Test dirty shutdown recovery. Test stale detection. Use mocks for the facade. GREEN: implement. Commit per behavior: `test: session_start auto-init` → `feat: auto-init on session_start`
4. **Session shutdown.** RED: test shutdown calls save. GREEN: implement. Commit: `test: session_shutdown` → `feat: save on shutdown`
5. **Create `mykb-dev` vfa profile.** Mount `dist/extension/` into Pi container. Verify extension loads (check stderr for startup log). Commit: `chore: add mykb-dev vfa profile`
6. **LLM acceptance tests.** Run the session lifecycle tests via vfa. Verify no errors, git commits appear.

**Deliverables:**
- `src/extension/index.ts` — Pi extension entry point, registers all hooks + tools
- `src/extension/state.ts` — session state (loaded areas, turn count, signal buffer)
- `src/extension/hooks/session.ts`:
  - `session_start` → auto-init brain, dirty shutdown recovery, stale check, hydrate
  - `session_shutdown` → kb save (auto-commit)

**Unit tests:**
- session_start with no brain → calls initBrain
- session_start with dirty shutdown → calls recoverDirtyShutdown
- session_start with stale cache → calls hydrateDatabase
- session_start with fresh cache → skips hydration
- session_shutdown → calls save
- State initializes with empty loaded areas set

**LLM acceptance tests via vfa:**
```bash
# Test 1: Session starts cleanly, no errors
vfa session start --provider pi --profile mykb-dev --prompt "Say hello"
# Expected: AI responds normally, no extension errors in stderr

# Test 2: Session end commits
vfa session close
# Verify: git log in ~/.mykb shows commit

# Test 3: Multi-turn session preserves state
vfa session start --provider pi --profile mykb-dev --prompt "Add a fact to test-area: the sky is blue"
vfa session send --prompt "Now search the knowledge base for sky"
# Expected: AI finds the fact it just added
vfa session close
```

---

## Phase 7: Pi Extension — Registered Tools

**Goal:** AI can interact with the knowledge base via native Pi tools.

**SOLID focus:** Single Responsibility — each tool file does one thing (one tool registration). Interface Segregation — tools depend only on the facade methods they need (`kb_add` needs `addFact`, `kb_search` needs `search`).

**Pattern:** Each tool file exports a registration function that receives the Pi API and the facade as parameters: `registerKbAdd(pi: ExtensionAPI, store: KnowledgeStore)`. The extension entry point (Phase 6) calls these with the facade it created. Tools call the facade in-process — not the CLI binary. Tool descriptions and parameter schemas are critical — they're what the AI reads to decide which tool to use.

**Development process:**
1. **One tool at a time.** For each tool: RED: test the `execute` function with mock params, verify return format. GREEN: implement. Then LLM acceptance test via vfa.
2. **Tool descriptions matter.** The `description`, `promptSnippet`, and `promptGuidelines` fields determine whether the AI picks the right tool. Write them clearly, test them with LLM acceptance tests. If the AI picks the wrong tool, the description needs rewriting — not the code.
3. **Priority order.** `kb_add` → `kb_search` → `kb_load` → `kb_list` → `kb_verify`. Add is most important (AI needs to save knowledge), search is second (AI needs to find knowledge).
4. **Return format.** All tools return compact markdown (same as `renderMarkdown`). The AI processes text, not JSON. Keep responses concise — token-efficient.

**Deliverables:**
- `src/tools/kb-add.ts` — `kb_add` tool (add any knowledge type)
- `src/tools/kb-search.ts` — `kb_search` tool (FTS5 search)
- `src/tools/kb-load.ts` — `kb_load` tool (load area, returns compact markdown)
- `src/tools/kb-list.ts` — `kb_list` tool (list areas with summaries)
- `src/tools/kb-verify.ts` — `kb_verify` tool (refresh provenance)

**Unit tests:**
- Each tool's execute function returns correct content format
- kb_add with non-existent area → auto-creates area, returns ID
- kb_search returns ranked results with area and type labels
- kb_load returns compact markdown with provenance
- kb_list returns area summaries
- kb_verify updates provenance date

**LLM acceptance tests via vfa:**
```bash
# Test 1: AI chooses kb_add unprompted when asked to save knowledge
vfa run --provider pi --profile mykb-dev \
  --prompt "Remember that our API runs on port 8443. Save this to the api-gateway area."
# Expected: AI uses kb_add tool, confirms the fact was saved

# Test 2: AI uses kb_search when asked to find something
vfa run --provider pi --profile mykb-dev \
  --prompt "Do we have any knowledge about port 8443?"
# Expected: AI uses kb_search, returns the fact from test 1

# Test 3: AI uses kb_list to discover areas
vfa run --provider pi --profile mykb-dev \
  --prompt "What knowledge areas do we have?"
# Expected: AI uses kb_list, shows area summaries

# Test 4: Tool descriptions are clear enough that AI picks the right tool
vfa run --provider pi --profile mykb-dev \
  --prompt "Load everything we know about networking"
# Expected: AI uses kb_load (not kb_search), returns full area
```

---

## Phase 8: Pi Extension — Three-Tier Delivery

**Goal:** Knowledge appears in context automatically. The core value proposition.

**SOLID focus:** Open/Closed — new signal providers can be added without modifying the scorer. Interface Segregation — each hook depends only on the signals it collects and the scorer it feeds.

**Pattern:** Strategy — signal providers (`FilePathSignal`, `CommandSignal`, `KeywordSignal`) are pluggable strategies implementing `SignalProvider` interface. The scorer aggregates across strategies without knowing their internals. Observer — each hook independently feeds signals to the scorer.

**Development process:**
1. **Tier 1 first.** RED: test that `before_agent_start` handler reads manifest and injects area index into system prompt. GREEN: implement. This is the simplest tier — no scoring, just read manifest and format. LLM acceptance test: AI can list areas it wasn't told about. Commit: `test: Tier 1 injection` → `feat: inject area index on session start`
2. **Test fixtures.** Create `tests/fixtures/` with sample brain data: 3 areas (networking, ci-pipelines, secrets), 5+ facts each with varied tags and provenance. These fixtures are used by scorer tests and LLM acceptance tests throughout Phase 8.
3. **Scorer.** RED: test `SignalProvider` interface with a mock provider. Test score aggregation with multiple providers. Test token budget truncation. Test empty signals → empty result (first-turn behavior). Table-driven tests with fixture data. GREEN: implement scorer + budget enforcement. Commit: `test: scorer` → `feat: implement relevance scorer`
4. **Signal providers.** One at a time. RED: test each provider produces correct scores from sample signals. GREEN: implement. Commit per provider: `test: file path signal` → `feat: implement FilePathSignal`
5. **Tier 2.** RED: test that `context` event handler collects signals and injects matching facts. Test first-turn (no signals) → no Tier 2 injection (Tier 1 index is sufficient). GREEN: implement by wiring scorer + signal providers + context injection. LLM acceptance test: AI answers from injected knowledge without being told to load. Commit: `test: Tier 2 context injection` → `feat: implement Tier 2`
6. **Signal collection hooks.** Wire `tool-call.ts`, `tool-result.ts`, `input.ts` to feed signals to the scorer. Each is a simple observer that calls `state.addSignal()`. Commit per hook.
7. **Tier 3.** RED: test `/kb` command loads full area. GREEN: implement via `registerCommand`. LLM acceptance test: `/kb networking` gives AI comprehensive knowledge. Commit: `test: /kb command` → `feat: implement Tier 3`
8. **Negative test.** LLM acceptance test: irrelevant prompt ("What is 2+2?") does NOT trigger knowledge injection.

**Deliverables:**
- `src/extension/hooks/session.ts` (extend):
  - Tier 1: inject area index into system prompt via `before_agent_start`
- `src/extension/scorer.ts` — relevance scoring:
  - `ScoreResult` type
  - `SignalProvider` interface
  - File path signal provider
  - Command pattern signal provider
  - Keyword signal provider
  - Score aggregation across providers
  - Token budget enforcement
- `src/extension/hooks/context.ts`:
  - Tier 2: `context` event → collect signals → score areas → inject relevant facts
- `src/extension/hooks/tool-call.ts`:
  - Capture file paths and commands as signals for scorer
- `src/extension/hooks/tool-result.ts`:
  - Capture tool results as signals for scorer
- `src/extension/hooks/input.ts`:
  - Capture user prompts as signals for scorer
- `/kb` command registration:
  - Tier 3: `registerCommand("kb")` → load full area on demand

**Tests:**
- Tier 1: session_start injects area index into system prompt
- Tier 2: context event with file-path signal → correct area scored highest
- Tier 2: context event with keyword signal → correct area scored highest
- Tier 2: token budget enforced → output truncated at limit
- Tier 2: sticky areas persist across turns
- Tier 3: /kb command loads full area into context
- Scorer: multiple signals combine correctly
- Scorer: empty brain → no injection, no error
- Scorer: no signals (first turn) → no Tier 2 injection, Tier 1 index is sufficient
- Test fixtures: 3 areas, 5+ facts each with tags and provenance

**LLM acceptance tests via vfa:**
```bash
# Pre-seed knowledge via CLI
kb add fact networking "DNS uses CoreDNS with zone forwarding to 10.0.0.2" --source "docs"
kb add fact ci-pipelines "Runners use spot instances with 60% cost savings" --source "cloud-console"
kb add gotcha networking "NAT gateway has asymmetric routing" --source "debugging"

# Test 1: Tier 1 — AI knows what areas exist without being told
vfa run --provider pi --profile mykb-dev \
  --prompt "What knowledge domains are available?"
# Expected: AI lists networking, ci-pipelines (from system prompt index)

# Test 2: Tier 2 — AI answers from auto-injected context
vfa run --provider pi --profile mykb-dev \
  --prompt "What DNS setup do we use?"
# Expected: AI answers "CoreDNS with zone forwarding" WITHOUT being told to load an area

# Test 3: Tier 2 — AI uses gotchas in context
vfa run --provider pi --profile mykb-dev \
  --prompt "Are there any known issues with our NAT configuration?"
# Expected: AI mentions asymmetric routing from injected gotcha

# Test 4: Tier 3 — /kb command loads full area
vfa session start --provider pi --profile mykb-dev --prompt "/kb networking"
vfa session send --prompt "Tell me everything you know about our networking setup"
# Expected: AI has full networking area in context, answers comprehensively
vfa session close

# Test 5: Tier 2 doesn't inject irrelevant areas
vfa run --provider pi --profile mykb-dev \
  --prompt "What is 2 + 2?"
# Expected: AI answers 4, does NOT mention DNS or runners
```

---

## Phase 9: Pi Extension — Tool Gating

**Goal:** AI cannot directly edit knowledge files.

**SOLID focus:** Open/Closed — gating rules can be extended (new file patterns) without modifying the hook handler logic.

**Development process:**
1. **Gating rules.** RED: test that write to `.jsonl` is blocked. Test that write to `area.json` is blocked. Test that write to unrelated file is allowed. Table-driven with file paths. GREEN: implement. Commit: `test: tool gating rules` → `feat: implement tool gating`
2. **Block reason.** RED: test that blocked response includes reason text pointing to `kb_add`/`kb_update`. GREEN: implement. Commit: `test: block reason message` → `feat: block reason with tool redirect`
3. **LLM acceptance test.** Verify AI reads the block reason and switches to the registered tool. This was already proven in spike 02 — verify it still works with the real implementation.

**Deliverables:**
- `src/extension/hooks/tool-call.ts` (extend):
  - Block `write`/`edit` to `.jsonl`, `area.json`, `manifest.json` in brain path
  - Return block reason pointing to `kb_add` / `kb_update` tools

**Tests:**
- Write to .jsonl → blocked with reason
- Write to area.json → blocked with reason
- Write to unrelated file → allowed
- AI receives block reason (via vfa integration test)

**LLM acceptance tests via vfa:**
```bash
vfa run --provider pi --profile mykb-dev \
  --prompt "Write hello to a file called test.jsonl"
# Expected: blocked, AI explains restriction

vfa run --provider pi --profile mykb-dev \
  --prompt "Create a file called notes.txt with some content"
# Expected: allowed — only .jsonl and brain metadata files are gated
```

---

## Phase 10: Packaging + Distribution

**Goal:** Installable Pi Package on npm.

**Deliverables:**
- `package.json` finalized with `pi` field, `bin` field, peer dependencies
- Build pipeline: `npm run build` produces `dist/` with extension + CLI
- `npm publish` to `@vilosource/mykb`
- Installation verified: `pi install npm:@vilosource/mykb`
- Updated README with installation instructions
- Updated vfa profile to use installed package instead of mounted spike

**Tests:**
- `pi install npm:@vilosource/mykb` succeeds
- Extension auto-discovered after install
- `kb` CLI available via npx or bin link
- All tools and commands functional after install

---

## Phase Summary

| Phase | What | Depends on | Unit tests | Integration tests | LLM acceptance tests |
|-------|------|-----------|-----------|------------------|---------------------|
| 0 | Scaffold | — | placeholder | — | — |
| 1 | Types + Config | 0 | yes | — | — |
| 2 | JSONL Store | 1 | yes | — | — |
| 3 | SQLite + FTS5 | 1 | yes | — | — |
| 4 | Core Facade | 2, 3 | yes | — | — |
| 5 | CLI | 4 | — | yes (CLI commands) | — |
| 6 | Extension Core | 4 | yes | — | yes (session lifecycle) |
| 7 | Extension Tools | 4, 6 | yes | — | yes (AI uses tools correctly) |
| 8 | Three-Tier Delivery | 7 | yes (scorer) | — | yes (AI answers from injected knowledge) |
| 9 | Tool Gating | 7 | yes | — | yes (AI follows redirect) |
| 10 | Packaging | all | — | yes (install) | yes (end-to-end) |

## Milestones

**M1: Core works (Phases 0-4)**
The foundation. JSONL + SQLite + dual-write + full API. Everything is testable but no user-facing interface yet.

**M2: CLI works (Phase 5)**
First user-facing interface. Developer can manage knowledge from the terminal. Full workflow possible without Pi.

**M3: Extension works (Phases 6-7)**
The AI can interact with knowledge via tools. Session lifecycle managed. This is the minimum viable product for Pi integration.

**M4: Smart delivery (Phase 8)**
The core value proposition. Knowledge appears in context automatically. This is what makes mykb different from a simple knowledge store.

**M5: Ship it (Phases 9-10)**
Enforcement + packaging. Ready for other users.
