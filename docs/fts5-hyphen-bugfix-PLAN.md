# FTS5 Hyphen Search Bug — Implementation Plan

Parent: Known issue in docs/osb-migration-GUIDE.md
Manifesto: docs/development-MANIFESTO.md

## Root Cause

FTS5 interprets `-` as a column prefix operator. `fi-abakus` is parsed as `fi:abakus` ("search column `fi` for `abakus`") which throws `no such column: fi`. This affects `searchEntries()` in `db.ts` and `matchAreas()` in `knowledge-store.ts`.

## Approach

Bottom-up: sanitization function → integrate into `searchEntries()` and `matchAreas()` → verify via CLI.

## Testing Layers

| Layer | What | How | When |
|---|---|---|---|
| Unit | `sanitizeFtsQuery()` handles all edge cases | Table-driven vitest | Every commit |
| Unit | `searchEntries()` returns results for hyphenated queries | vitest with in-memory SQLite | Every commit |
| Unit | `matchAreas()` returns results for hyphenated queries | vitest with in-memory SQLite | Every commit |
| Integration | `kb search "fi-abakus"` returns results | CLI invocation | Phase completion |

## Design

**Function:** `sanitizeFtsQuery(query: string): string`
- Split on whitespace
- Wrap each token in double quotes (makes hyphens literal in FTS5)
- Join with space (FTS5 implicit AND)
- This preserves multi-word AND behavior: `postnord server` → `"postnord" "server"`

**Location:** `src/core/db.ts` (same module as searchEntries — SRP: db.ts owns FTS5 queries)

**Consumers:** `searchEntries()` in db.ts, `matchAreas()` in knowledge-store.ts

## Phase 1: RED — Failing Tests

**Goal:** Write tests that describe the desired behavior. All should fail.

**Depends on:** Nothing

**Design focus:** Table-driven tests (manifesto rule). Test behavior, not implementation.

**Development process:**

1. Add table-driven tests for `sanitizeFtsQuery()` in `tests/core/db.test.ts`
2. Add test case for `searchEntries()` with hyphenated entry text
3. Add test case for `matchAreas()` in `tests/core/knowledge-store.test.ts` (if exists, otherwise db.test.ts)
4. Run tests, confirm RED
5. Commit: `test: add failing tests for FTS5 hyphenated query search`

**Table-driven test cases for `sanitizeFtsQuery`:**

| Input | Expected | Notes |
|---|---|---|
| `"fi-abakus"` | `"\"fi-abakus\""` | Hyphenated term |
| `"DNS"` | `"\"DNS\""` | Simple term |
| `"postnord server"` | `"\"postnord\" \"server\""` | Multi-word AND |
| `"fi-sr-012"` | `"\"fi-sr-012\""` | Multiple hyphens |
| `""` | `""` | Empty string |
| `"  spaced  "` | `"\"spaced\""` | Extra whitespace |
| `"PLANDENT-004"` | `"\"PLANDENT-004\""` | Decision ID pattern |

**Deliverables:** New test cases in `tests/core/db.test.ts`

**Verification:** All new tests fail (RED). All existing tests still pass.

## Phase 2: GREEN — Implementation

**Goal:** Minimum code to make all tests pass.

**Depends on:** Phase 1

**Design focus:** SRP — sanitization is a pure function in db.ts. No changes to function signatures.

**Development process:**

1. Implement `sanitizeFtsQuery()` in `src/core/db.ts`
2. Apply sanitization in `searchEntries()` before MATCH
3. Apply sanitization in `matchAreas()` in `src/core/knowledge-store.ts` before MATCH
4. Export `sanitizeFtsQuery` for testability
5. Run tests, confirm GREEN
6. Commit: `feat: sanitize FTS5 queries to handle hyphens and special characters`

**Deliverables:** `sanitizeFtsQuery()` in db.ts, updated MATCH calls in db.ts and knowledge-store.ts

**Verification:** All tests pass (new + existing).

**Integration check:** `kb rebuild && kb search "fi-abakus"` returns matching entries.

## Phase 3: REFACTOR (if needed)

**Goal:** Clean up without changing behavior.

**Depends on:** Phase 2

Only if Phase 2 introduced duplication or unclear code. Otherwise skip.

## Phase Gate

- [ ] All vitest tests pass (existing + new)
- [ ] No regressions
- [ ] `kb search "fi-abakus"` works from CLI
- [ ] `kb search "PLANDENT-004"` works from CLI
- [ ] TDD commit sequence in git log
- [ ] No hardcoded secrets or environment-specific values

## Phase Summary

| Phase | What | Depends On | Verification | Integration |
|-------|------|-----------|-------------|-------------|
| 1 | Failing tests | -- | New tests fail, existing pass | -- |
| 2 | sanitizeFtsQuery + wiring | 1 | All tests pass | `kb search "fi-abakus"` |
| 3 | Refactor (optional) | 2 | All tests pass | -- |
