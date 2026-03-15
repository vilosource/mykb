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
| `mykb-dev` | `dist/extension/` → Pi extensions | Real implementation testing (phases 6+) |

`mykb-dev` profile must be created before Phase 6 starts. It mounts the compiled extension output.

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

**Deliverables:**
- `src/core/types.ts` — all interfaces and types:
  - `KnowledgeEntry` (common envelope), `FactEntry`, `DecisionEntry`, `GotchaEntry`, `PatternEntry`, `LinkEntry`
  - `Provenance`, `ProvenanceStatus` enum
  - `Zone` enum
  - `AreaMetadata`
  - `ManifestFile`
  - `KnowledgeStore` interface
  - `SearchEngine` interface
  - `EntryFilter` type
- `src/core/config.ts` — brain location resolution:
  - `resolveBrainPath()` — `$MYKB_DIR` → `~/.mykb/` fallback
  - `brainExists()` — check if brain directory is initialized
- `src/core/id.ts` — nanoid generation wrapper
- `src/core/errors.ts` — domain-specific error classes (see Error Classes section above)

**Tests:**
- Type validation (compile-time, no runtime tests needed)
- Each error class has correct name and message format
- `resolveBrainPath` with/without env var
- `brainExists` with existing/missing directory
- nanoid generation produces 8-char alphanumeric strings

---

## Phase 2: JSONL Store

**Goal:** Read and write knowledge entries to JSONL files.

**Deliverables:**
- `src/core/store.ts` — JSONL operations:
  - `appendEntry(area, entry)` — append JSON line to type-specific JSONL file
  - `readEntries(area, type)` — read all lines, resolve latest version per ID, exclude tombstones
  - `readAllEntries(area)` — read across all JSONL files for an area
  - `writeTombstone(area, id)` — append deletion marker
  - `compactEntries(area, type?)` — rewrite JSONL: collapse to latest per ID, remove tombstones, remove superseded lines
- `src/core/area.ts` — area management:
  - `createArea(id, name, summary)` — create directory + area.json
  - `readAreaMetadata(id)` — read area.json
  - `updateAreaMetadata(id, updates)` — update area.json fields
  - `listAreas()` — scan areas/ directory, read each area.json
  - `areaExists(id)` — check if area directory exists
- `src/core/manifest.ts` — manifest generation:
  - `regenerateManifest()` — scan all area.json files, write manifest.json
  - `readManifest()` — read manifest.json

**Tests:**
- Append entry → read it back → matches
- Append two entries with same ID → readEntries returns latest only
- Tombstone → entry disappears from readEntries
- Create area → directory + area.json exist
- List areas → returns all area metadata
- Regenerate manifest → matches area.json contents
- Auto-create area directory + JSONL files on first write
- Handle malformed JSONL lines (skip, don't crash)
- Compact → JSONL has only latest version per ID, no tombstones
- Compact is idempotent — running twice produces same result

---

## Phase 3: SQLite + FTS5

**Goal:** Query cache with full-text search, hydration from JSONL.

**Deliverables:**
- `src/core/db.ts` — SQLite interface:
  - `createDatabase(path)` — create schema, enable WAL mode
  - `upsertEntry(entry)` — INSERT OR REPLACE
  - `deleteEntry(id)` — DELETE by ID
  - `queryEntries(filter)` — query by area, type, zone, tags, provenance status
  - `searchEntries(query)` — FTS5 MATCH with BM25 ranking
  - `getAreaStats(area)` — count by type
  - `upsertArea(metadata)` — area metadata
  - `listAreas()` — all area metadata
  - `getLastHydrated()` / `setLastHydrated()` — staleness tracking timestamp
- `src/core/hydrate.ts` — JSONL → SQLite rebuild:
  - `hydrateDatabase(db, brainPath)` — full rebuild from all JSONL files
  - `isStale(db, brainPath)` — compare file mtimes against last_hydrated
  - `ensureFresh(db, brainPath)` — hydrate only if stale

**Tests:**
- Create database → schema exists, WAL enabled
- Upsert entry → query returns it
- Upsert same ID twice → latest wins
- Delete entry → query returns nothing
- FTS5 search → returns matching entries ranked by relevance
- FTS5 search for non-existent term → empty results
- Hydrate from JSONL → all entries in SQLite
- Hydrate with tombstones → deleted entries absent
- isStale returns true after JSONL modification
- isStale returns false when cache is current
- Area stats return correct counts per type

---

## Phase 4: Core Library Facade

**Goal:** High-level API that wires store + db together with dual-write.

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

**Deliverables:**
- `src/extension/hooks/tool-call.ts` (extend):
  - Block `write`/`edit` to `.jsonl`, `area.json`, `manifest.json` in brain path
  - Return block reason pointing to `kb_add` / `kb_update` tools

**Tests:**
- Write to .jsonl → blocked with reason
- Write to area.json → blocked with reason
- Write to unrelated file → allowed
- AI receives block reason (via vfa integration test)

**Demo via vfa:**
```
vfa run --provider pi --profile mykb-spike \
  --prompt "Write hello to a file called test.jsonl"
# Expected: blocked, AI explains restriction
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
