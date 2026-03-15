# mykb Development Manifesto

These rules govern how code is written in this project. No exceptions.

---

## 1. TDD — Red/Green/Refactor

Every feature starts with a failing test.

1. **RED** — Write a test that describes the desired behavior. Run it. Watch it fail. If it passes, the test is wrong or the feature already exists.
2. **GREEN** — Write the minimum code to make the test pass. No more. Resist the urge to add "while I'm here" improvements.
3. **REFACTOR** — Clean up the implementation. Tests must still pass. No new behavior in this step.

**Rules:**
- No implementation code without a failing test driving it
- One commit per step: test (RED), implementation (GREEN), refactor (optional)
- Tests describe behavior, not implementation details
- Table-driven tests for functions with multiple input/output cases
- Test names describe the scenario: `should return empty array when area has no facts`

**What to test:**
- Core library: unit tests with in-memory SQLite and temp JSONL files
- CLI: integration tests that invoke commands and verify output + side effects
- Extension hooks: unit tests with mock Pi event objects
- Scorer: unit tests with fixture data, verify area ranking

**What NOT to test:**
- Pi's internal behavior (it's not our code)
- SQLite's correctness (trust the engine)
- Third-party libraries

## 2. SOLID Principles

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

```
// YES — depend on interface
function addFact(store: KnowledgeStore, entry: FactEntry): string

// NO — depend on concrete
function addFact(jsonlPath: string, sqliteDb: Database, entry: FactEntry): string
```

- Core library defines interfaces in `types.ts`
- Implementations satisfy interfaces
- CLI and extension receive dependencies via constructor injection or factory functions
- Tests inject mocks/stubs that satisfy the same interfaces

## 3. Design Patterns

| Pattern | Where | Why |
|---------|-------|-----|
| **Repository** | `store.ts` | Abstracts JSONL + SQLite behind a clean `KnowledgeStore` interface. Callers don't know about files or databases. |
| **Strategy** | `scorer.ts` | Signal providers are pluggable. File-path scoring, command scoring, keyword scoring are independent strategies. |
| **Facade** | Core library API | Simple high-level functions (`addFact`, `loadArea`, `search`) hide the JSONL → SQLite → FTS5 complexity. |
| **Observer** | Extension hooks | Pi events are subscribed to, not polled. Each hook is an independent observer. |
| **Factory** | DB initialization | `createDatabase()` handles schema creation, WAL mode, FTS5 setup. Callers get a ready-to-use database. |
| **Null Object** | Missing brain | When brain doesn't exist, return empty results instead of throwing. Auto-init handles creation. |

## 4. TypeScript Standards

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

## 5. Commit Discipline

**One logical change per commit.** Each commit should be independently understandable and revertable.

**TDD commit sequence:**
```
test: add failing test for addFact with verified provenance
feat: implement addFact with provenance support
refactor: extract provenance builder into separate function
```

**Conventional commits:**
- `test:` — test code (RED step)
- `feat:` — implementation code (GREEN step)
- `refactor:` — refactoring (REFACTOR step)
- `fix:` — bug fix
- `docs:` — documentation
- `chore:` — build, tooling, dependencies

**No AI attribution in commits.** No "Generated with", no "Co-Authored-By", no mentions of AI assistance.

## 6. Code Review Checklist

Before considering any code complete:

- [ ] Every public function has a test
- [ ] Tests describe behavior, not implementation
- [ ] No `any` types
- [ ] Interfaces defined before implementations
- [ ] Dependencies injected, not hardcoded
- [ ] Single responsibility — each module does one thing
- [ ] Error cases handled — not swallowed, not ignored
- [ ] No premature abstractions — if it's used once, inline it
- [ ] No dead code — if it's not called, delete it
- [ ] Functions under 30 lines — if longer, extract
