# mykb Development Manifesto

**Version:** 2.0
**Status:** Mandatory — all development work must follow this document

These rules govern how code is written in this project. No exceptions.

---

## 1. TDD — Red/Green/Refactor

Every feature starts with a failing test.

1. **RED** — Write a test that describes the desired behavior. Run it. Watch it fail. If it passes, the test is wrong or the feature already exists.
2. **GREEN** — Write the minimum code to make the test pass. No more. Resist the urge to add "while I'm here" improvements.
3. **REFACTOR** — Clean up the implementation. Tests must still pass. No new behavior in this step.

**Rules:**
- No implementation code without a failing test driving it
- Tests describe behavior, not implementation details
- Table-driven tests for functions with multiple input/output cases
- Test names describe the scenario: `getActiveWorkspaceId with KB_SESSION_ID set + session file exists returns file content`

**Commit granularity:**
- Default: one commit per step (`test:` RED, `feat:` GREEN, `refactor:` optional)
- Combined RED+GREEN is acceptable when the change is small and cohesive (e.g., <50 lines of implementation, tests and code tell one story). Use a single `feat:` commit.
- Never combine across features. Each feature gets its own RED/GREEN cycle.

**What NOT to test:**
- Pi's internal behavior (it's not our code)
- SQLite's correctness (trust the engine)
- Third-party libraries

---

## 2. Testing Pyramid

Every layer has specific things it MUST verify. No layer is optional when triggered.

| Layer | What it tests | Speed | Runs on |
|-------|--------------|-------|---------|
| **1. Unit** | Core library logic, exact assertions | ms | Every commit |
| **2. CLI Integration** | Commands through the real CLI binary, output + side effects | seconds | Every commit |
| **3. E2E Isolation** | Concurrent access, multi-instance state, cross-process behavior | seconds | When triggered (see rules below) |
| **4. Behavioral** | LLM-facing output quality via string matching or LLM-as-judge | seconds | When triggered (see rules below) |

Layers 1-2 are deterministic and must never be flaky. Layers 3-4 may involve real processes or LLM calls.

### Layer 1: Unit Tests

**Location:** `tests/core/`, `tests/extension/`, `tests/tools/`

Must verify:
- Method returns correct data for valid input
- Method returns null or throws typed error for invalid input
- Edge cases: empty input, null, boundary values
- Env var save/restore in tests that modify `process.env`

Must NOT rely on:
- Real brain directory (use `withTempBrain` helper)
- Network, Docker, or git

### Layer 2: CLI Integration Tests

**Location:** `tests/cli/`

Must verify:
- Command exits 0 on success, non-zero on failure
- Output contains expected content
- File mutations are durable: write → read back → data present
- Cross-command round-trips: `kb work start` → `kb work show` → workspace visible
- Error messages are actionable (tell the user what to do)

**How to run:**
```bash
npm test                                          # all tests
npx vitest run tests/cli/work.test.ts             # single file
npx vitest run tests/cli/ -t "creates a workspace" # single test
```

### Layer 3: E2E Isolation Tests

**Location:** `tests/cli/session-isolation.test.ts` (and similar)

Must verify:
- Concurrent access to shared state produces correct results per actor
- One actor's operations do not corrupt another actor's state
- Backward compatibility: absence of isolation mechanism falls back correctly
- Cleanup: ephemeral state is removed on stop/exit

**How to run:**
```bash
npx vitest run tests/cli/session-isolation.test.ts
```

### Layer 4: Behavioral Validation

**Location:** `tests/behavioral/` (when created)

For features where mykb's output is consumed by an LLM (context delivery, rendered markdown, area index), quality matters beyond structural correctness.

**String matching** — when checking for specific content presence:
```typescript
expect(rendered).toContain('## Knowledge');
expect(rendered).not.toContain('undefined');
```

**LLM-as-judge** — when evaluating readability, completeness, or usefulness:
- Feed the rendered output to an LLM with evaluation criteria
- Judge returns pass/fail with reason
- Use for: Tier 1 area index quality, context injection completeness, rendered workspace state clarity

---

## 3. Change Type → Test Requirements

Different changes demand different test layers. Use this table to determine which tests are mandatory.

| Change type | Layer 1 (Unit) | Layer 2 (CLI) | Layer 3 (E2E Isolation) | Layer 4 (Behavioral) |
|---|---|---|---|---|
| Pure logic (scorer, parser, renderer) | Required | — | — | If LLM-facing output |
| New CLI command or flag | Required | Required | — | — |
| Shared mutable state (files read/written by multiple processes) | Required | Required | **Required** | — |
| Data format change (JSONL schema, workspace.json) | Required | Required | — | — |
| LLM-facing output (context delivery, area index, rendered markdown) | Required | — | — | **Required** |
| Bug fix | Required (reproduce first) | If CLI-visible | If concurrency-related | — |
| Cross-repo feature | Required per repo | Required per repo | **Required** (end-to-end) | — |

**The rule:** If your change touches shared mutable state — any file, database, or resource that multiple processes may access simultaneously — you must write an E2E isolation test proving concurrent access is safe. Unit tests with mocked filesystems are not sufficient.

---

## 4. Feature Completion Checklist

Before a feature is considered done, every applicable item must be checked.

### Tests

- [ ] Unit test for the happy path
- [ ] Unit test for each error case
- [ ] If the feature adds/changes a CLI command → CLI integration test (exit code, output, side effects)
- [ ] If the feature touches shared mutable state → E2E isolation test with concurrent actors
- [ ] If the feature changes LLM-facing output → behavioral validation (string matching or LLM-as-judge)
- [ ] If the feature spans multiple repos → integration test in each repo, plus a cross-boundary test
- [ ] If the feature uses env vars → tests save/restore `process.env` to prevent cross-test pollution
- [ ] Full test suite passes: `npm test`

### Code

- [ ] Every public function has a test
- [ ] No `any` types
- [ ] Interfaces defined before implementations
- [ ] Dependencies injected, not hardcoded
- [ ] Error cases handled — not swallowed, not ignored
- [ ] No dead code — if it's not called, delete it

### Build

- [ ] `npm run build` succeeds
- [ ] `npm test` passes (all tests, all layers)

---

## 5. Anti-Patterns

These are things that feel productive but cause bugs. Do not do them.

| Anti-Pattern | Why It's Bad | Do This Instead |
|---|---|---|
| Write code first, add tests after | Tests verify the implementation, not the requirement. They pass by construction and miss edge cases. | RED → GREEN → REFACTOR. Always. |
| Unit test shared mutable state with mocks only | Mocks prove method logic, not concurrent behavior. Two tests passing independently doesn't prove two processes won't corrupt each other. | Unit tests for logic AND E2E tests with concurrent actors through the real CLI. |
| Test the method but not the CLI path | A method that works in isolation may not be wired correctly. The CLI may parse args wrong, pass the wrong env, or skip the method entirely. | Layer 2 CLI integration tests for every user-facing behavior. |
| Skip E2E tests because "unit tests cover it" | Unit tests for `getActiveWorkspaceId()` passed. But the actual bug — two sessions clobbering `.active` — only manifests when two CLI processes run concurrently. Unit tests can't catch this. | Write E2E tests for the scenario the feature is designed to handle. |
| Modify `process.env` without save/restore | Test A sets `KB_SESSION_ID`. Test B runs without it but inherits A's value. Test B passes for the wrong reason. | `beforeEach`/`afterEach` save and restore env vars. Use unique IDs (`test-${randomUUID()}`) per test. |
| Combine RED+GREEN across features | Mixing two features in one commit makes it impossible to revert one without the other. | One RED/GREEN cycle per feature. Combined commits only within a single feature. |
| Manifesto exists but CLAUDE.md doesn't reference it | An AI agent will never read a manifesto it doesn't know about. The rules are followed only when the human remembers to enforce them. | Reference the manifesto from CLAUDE.md so it's loaded into every session. |

---

## 6. SOLID Principles

### Single Responsibility (S)

Every module does one thing. If you can't describe what it does in one sentence without "and", split it.

| Module | Responsibility |
|--------|---------------|
| `store.ts` | Read/write JSONL files and area.json metadata |
| `db.ts` | SQLite queries and FTS5 search |
| `hydrate.ts` | Rebuild SQLite from JSONL files |
| `config.ts` | Resolve brain location and settings |
| `types.ts` | Type definitions and validation |
| `render.ts` | Format knowledge entries as markdown for LLM consumption |
| `scorer.ts` | Score area relevance from signals |
| `state.ts` | Track session state (loaded areas, turn count) |
| `workspace.ts` | Workspace CRUD, active workspace tracking, session isolation |

### Open/Closed (O)

Modules are open for extension, closed for modification.

- The scorer accepts new signal sources via a `SignalProvider` interface — adding file-path scoring doesn't modify keyword scoring
- Knowledge types (fact, decision, gotcha, pattern, link) are defined in a type map — adding a new type doesn't modify existing handlers
- Output renderers implement a `Renderer` interface — adding YAML output doesn't modify the markdown renderer

### Liskov Substitution (L)

Any implementation of an interface can replace another without breaking callers.

- `KnowledgeStore` interface: JSONL+SQLite implementation today, could be pure SQLite or remote API tomorrow
- `SearchEngine` interface: FTS5 today, could be embeddings later
- Tests use in-memory implementations that satisfy the same interfaces

### Interface Segregation (I)

Consumers depend only on what they use.

| Consumer | Needs | Does NOT need |
|----------|-------|--------------|
| CLI | `KnowledgeStore`, `SearchEngine`, `Renderer` | Scorer, session state, Pi events |
| Extension hooks | `KnowledgeStore`, `SearchEngine`, `Scorer`, `State` | CLI arg parsing, renderer |
| Registered tools | `KnowledgeStore`, `SearchEngine` | Scorer, session hooks |
| Scorer | `SearchEngine`, `State` | Store writes, CLI, renderer |

### Dependency Inversion (D)

High-level modules depend on abstractions, not concrete implementations.

```typescript
// YES — depend on interface
function addFact(store: KnowledgeStore, entry: FactEntry): string

// NO — depend on concrete
function addFact(jsonlPath: string, sqliteDb: Database, entry: FactEntry): string
```

- Core library defines interfaces in `types.ts`
- Implementations satisfy interfaces
- CLI and extension receive dependencies via constructor injection or factory functions
- Tests inject mocks/stubs that satisfy the same interfaces

## 7. Design Patterns

| Pattern | Where | Why |
|---------|-------|-----|
| **Repository** | `store.ts` | Abstracts JSONL + SQLite behind a clean `KnowledgeStore` interface. Callers don't know about files or databases. |
| **Strategy** | `scorer.ts` | Signal providers are pluggable. File-path scoring, command scoring, keyword scoring are independent strategies. |
| **Facade** | Core library API | Simple high-level functions (`addFact`, `loadArea`, `search`) hide the JSONL → SQLite → FTS5 complexity. |
| **Observer** | Extension hooks | Pi events are subscribed to, not polled. Each hook is an independent observer. |
| **Factory** | DB initialization | `createDatabase()` handles schema creation, WAL mode, FTS5 setup. Callers get a ready-to-use database. |
| **Null Object** | Missing brain | When brain doesn't exist, return empty results instead of throwing. Auto-init handles creation. |

## 8. TypeScript Standards

**Strict typing:**
- `strict: true` in tsconfig.json
- No `any` — use `unknown` + type guards if the type is truly unknown
- No type assertions (`as`) unless provably safe with a comment explaining why

**Interfaces before implementations:**
```typescript
// Define the contract first
interface KnowledgeStore {
  addEntry(area: string, entry: KnowledgeEntry): string;
  getEntry(area: string, id: string): KnowledgeEntry | null;
  listEntries(area: string, filter?: EntryFilter): KnowledgeEntry[];
  deleteEntry(area: string, id: string): void;
}

// Then implement
class JsonlSqliteStore implements KnowledgeStore {
  // ...
}
```

**Naming conventions:**
- Interfaces: `PascalCase`, no `I` prefix (`KnowledgeStore`, not `IKnowledgeStore`)
- Types: `PascalCase` (`FactEntry`, `ProvenanceStatus`)
- Functions: `camelCase` (`addFact`, `loadArea`)
- Files: `kebab-case` (`knowledge-store.ts`, `fact-entry.ts`)
- Constants: `UPPER_SNAKE_CASE` (`DEFAULT_BRAIN_PATH`, `MAX_TIER2_TOKENS`)
- Enums: `PascalCase` members (`ProvenanceStatus.Verified`)

**Module structure:**
- One public interface/class per file
- Export from barrel `index.ts` files per directory
- Internal helpers are not exported

**Error handling:**
- Define domain-specific error classes (`AreaNotFoundError`, `EntryValidationError`)
- Never catch and swallow errors silently
- Return `null` for "not found" cases, throw for "something is wrong" cases

## 9. Commit Discipline

**One logical change per commit.** Each commit should be independently understandable and revertable.

**TDD commit sequence:**
```
test: add failing test for addFact with verified provenance
feat: implement addFact with provenance support
refactor: extract provenance builder into separate function
```

**Combined commits:** RED+GREEN may be combined into a single `feat:` commit when the change is small (<50 lines implementation) and cohesive. Never combine across features.

**Conventional commits:**
- `test:` — test code (RED step, or adding missing test coverage)
- `feat:` — implementation code (GREEN step, or combined RED+GREEN)
- `refactor:` — refactoring (REFACTOR step)
- `fix:` — bug fix
- `docs:` — documentation
- `chore:` — build, tooling, dependencies

**No AI attribution in commits.** No "Generated with", no "Co-Authored-By", no mentions of AI assistance.

---

## Updating This Document

This manifesto is a living document. When a bug escapes that should have been caught:

1. Identify which checklist item would have prevented it
2. If no item exists, add one to the Feature Completion Checklist
3. If an anti-pattern caused it, add it to the Anti-Patterns table
4. Increment the version number

### Changelog

**v2.0 (2026-03-18)** — Major revision. Added testing pyramid (4 layers), change type → test requirements mapping, feature completion checklist, and anti-patterns table. Triggered by session isolation implementation where unit tests passed but the actual multi-instance bug was only caught by E2E tests that weren't written until prompted. The manifesto now mandates E2E isolation tests for any feature touching shared mutable state. Relaxed commit discipline to allow combined RED+GREEN for small changes. Added `workspace.ts` to module responsibility table.

**v1.0 (initial)** — TDD protocol, SOLID principles, design patterns, TypeScript standards, commit discipline, code review checklist.
