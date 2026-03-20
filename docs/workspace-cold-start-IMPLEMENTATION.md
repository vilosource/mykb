# Workspace Cold Start — Implementation Plan

**Prereq:** Read `workspace-cold-start-ANALYSIS.md` for problem definition and design rationale.

## Summary

Enhance `kb work start` output to be an effective nudge for AI agents on cold start. Two changes:
1. Render repo paths (stored but currently dropped)
2. Add knowledge area index with summaries and entry counts

## Design Principle

**Hooks as nudges.** The `kb work start` output is the nudge. It surfaces enough information that the agent naturally wants to load knowledge (`kb load <id>`), without forcing auto-injection. The area index with gotcha/decision counts acts as the trigger — "6 gotchas" signals "load me before you start."

## Scope

### In scope
- Render `links.repos` in workspace output
- Add knowledge area index section with summaries + entry counts by type
- Reorder output: identity → repos → state → area index → artifacts → journal
- Unit tests for render changes
- CLI integration tests for `kb work start` output
- Behavioral test: LLM-scannable area index

### Out of scope
- Auto-loading knowledge areas (violates nudge philosophy)
- Changes to `kb load` zone filtering (separate bug, separate fix)
- Pi extension or container agent changes (different injection paths)

## Changes by File

### 1. `src/core/types.ts` — New type

Add a composite type for area context passed to the renderer:

```typescript
export type AreaContext = {
  id: string;
  summary: string;
  stats: AreaStats;
};
```

This pairs the area summary (from `AreaMetadata`) with entry counts (from `AreaStats`) for each linked area. The renderer doesn't need to know where the data came from.

Note: `AreaStats` is currently defined in `db.ts`. It should be re-exported from `types.ts` or at minimum imported alongside `AreaContext`. No move needed — just import both where needed.

### 2. `src/core/render.ts` — Modify `renderWorkspace()`

**Signature change:**

```typescript
// Before
export function renderWorkspace(workspace: Workspace, journalEntries: JournalEntry[]): string

// After
export function renderWorkspace(
  workspace: Workspace,
  journalEntries: JournalEntry[],
  areaContexts?: AreaContext[],
): string
```

The third parameter is optional for backward compatibility — existing callers (like `kb work show`) that don't have area context continue to work.

**Rendering changes:**

1. After identity line, render repos:
   ```
   Repos: /path/to/repo1, /path/to/repo2
   ```

2. Replace the current `Areas: stark, infra-vm` line with a knowledge area index section:
   ```
   ## Knowledge Areas
   - **vmctl**: Azure VM power management dashboard — 16 facts, 14 decisions, 6 gotchas, 2 patterns, 1 link
   Run `kb load <id>` for full context before starting work.
   ```
   If `areaContexts` is not provided, fall back to the current `Areas: id1, id2` rendering.

3. Reorder sections: identity → repos → state → knowledge areas → artifacts → journal

**Rendering logic for area index:**
- For each `AreaContext`, render: `- **{id}**: {summary} — {counts}`
- Counts: only include non-zero types, formatted like `kb stats` does it
- After the list, render the nudge: `Run \`kb load <id>\` for full context before starting work.`
- If the workspace has linked areas but `areaContexts` is empty (areas don't exist in the brain), fall back to `Areas: id1, id2`

### 3. `src/cli/cli.ts` — Modify `work start` handler

**Current flow (lines 567-592):**
```
readWorkspace → setActive → syncArtifacts → readWorkspace → readJournal → renderWorkspace
```

**New flow:**
```
readWorkspace → setActive → syncArtifacts → readWorkspace → readJournal
→ fetchAreaContexts (NEW) → renderWorkspace(ws, journal, areaContexts)
```

**`fetchAreaContexts` logic:**
```typescript
const areaContexts: AreaContext[] = [];
if (updated.areas.length > 0) {
  const bp = requireBrain();
  const dbPath = path.join(bp, 'kb.db');
  const db = createDatabase(dbPath);
  try {
    for (const areaId of updated.areas) {
      const metadata = readAreaMetadata(bp, areaId);
      if (metadata) {
        const stats = getAreaStats(db, areaId);
        areaContexts.push({ id: areaId, summary: metadata.summary, stats });
      }
    }
  } finally {
    db.close();
  }
}
```

This reuses `readAreaMetadata` from `area.ts` (already used by `kb list`) and `getAreaStats` from `db.ts` (already used by `kb stats`). No new queries.

### 4. `src/cli/cli.ts` — Modify `work show` handler

The `work show` command also calls `renderWorkspace()`. It should pass area contexts too, so `kb work show` output is consistent with `kb work start`. Same `fetchAreaContexts` pattern — extract as a helper function to avoid duplication.

## Test Plan

### Layer 1: Unit Tests (`tests/core/render.test.ts`)

Modify existing `renderWorkspace` describe block. Existing tests continue to work (optional parameter).

| Test | What it verifies |
|------|-----------------|
| `renders repo paths from links.repos` | Repos line appears with correct paths |
| `renders multiple repo paths` | Comma-separated when multiple repos |
| `omits repos line when links.repos is empty or undefined` | No "Repos:" line when no repos |
| `renders knowledge area index with summaries and counts` | Area section with id, summary, counts |
| `renders only non-zero entry counts` | Area with 0 gotchas doesn't show "0 gotchas" |
| `renders nudge instruction after area index` | `kb load` instruction appears |
| `falls back to Areas line when areaContexts not provided` | Backward compatibility — existing behavior |
| `falls back to Areas line when areaContexts is empty array` | No "Knowledge Areas" section for empty array |
| `renders sections in correct order` | repos before state before areas before artifacts before journal |

### Layer 2: CLI Integration Tests (`tests/cli/work.test.ts`)

| Test | What it verifies |
|------|-----------------|
| `work start shows repo paths` | Create workspace with repos, start it, output contains repo path |
| `work start shows knowledge area index with entry counts` | Create workspace + area + entries, start it, output contains summary and counts |
| `work start nudge instruction present` | Output contains `kb load` instruction |

### Layer 4: Behavioral Tests (`tests/core/render.test.ts`)

| Test | What it verifies |
|------|-----------------|
| `knowledge area index is LLM-scannable` | Area IDs extractable, summaries readable, counts parseable, `kb load` instruction present |

## Implementation Steps (TDD)

### Step 1: Add `AreaContext` type
- Add type to `types.ts`
- No test needed (type-only change)
- Commit: `feat: add AreaContext type for workspace area index rendering`

### Step 2: RED — Render repo paths
- Add unit tests: `renders repo paths`, `renders multiple repo paths`, `omits repos line when empty`
- Run tests, confirm they fail
- Commit: `test: add failing tests for repo path rendering in workspace output`

### Step 3: GREEN — Implement repo rendering
- Add `links.repos` rendering to `renderWorkspace()`
- Run tests, confirm they pass
- Commit: `feat: render repo paths in workspace output`

### Step 4: RED — Knowledge area index rendering
- Add unit tests: `renders knowledge area index`, `renders only non-zero counts`, `renders nudge instruction`, `falls back when not provided`, `falls back when empty`
- Run tests, confirm they fail
- Commit: `test: add failing tests for knowledge area index in workspace output`

### Step 5: GREEN — Implement area index rendering
- Add optional `areaContexts` parameter to `renderWorkspace()`
- Implement area index section with summaries, counts, nudge instruction
- Run tests, confirm they pass
- Commit: `feat: render knowledge area index with entry counts in workspace output`

### Step 6: RED — Section ordering
- Add unit test: `renders sections in correct order`
- Run test, confirm it fails (current order is wrong)
- Commit: `test: add failing test for workspace output section ordering`

### Step 7: GREEN — Reorder sections
- Reorder rendering: identity → repos → state → knowledge areas → artifacts → journal
- Run tests, confirm they pass
- Commit: `feat: reorder workspace output sections for cold start readability`

### Step 8: RED — CLI integration
- Add CLI tests: `work start shows repo paths`, `work start shows knowledge area index`, `nudge instruction present`
- Run tests, confirm they fail
- Commit: `test: add failing CLI tests for workspace cold start output`

### Step 9: GREEN — Wire CLI handler
- Extract `fetchAreaContexts` helper
- Pass `areaContexts` to `renderWorkspace()` in `work start` and `work show` handlers
- Run tests, confirm they pass
- Commit: `feat: wire area context fetching into work start and work show CLI handlers`

### Step 10: Behavioral test
- Add LLM-scannable test for knowledge area index
- Should pass against current implementation
- Commit: `test: add behavioral validation for knowledge area index scannability`

### Step 11: Full suite verification
- Run `npm test` — all tests pass
- Run `npm run build` — builds clean
- Commit: none (verification only)

## Expected Output

Before:
```
# vmctl (vmctl)
Phase: implementation | Active: HTMX dashboard...
Areas: vmctl
Links: JIRA VMCTL-XXX

## Recent Journal
- 2026-03-19: Status check...
```

After:
```
# vmctl (vmctl)
Repos: /home/jasonvi/GitLab/.../vmctl
Phase: implementation | Active: HTMX dashboard...

## Knowledge Areas
- **vmctl**: Azure VM power management dashboard — 16 facts, 14 decisions, 6 gotchas, 2 patterns, 1 link
Run `kb load <id>` for full context before starting work.

Links: JIRA VMCTL-XXX
Artifacts:
  ...

## Recent Journal
- 2026-03-19: Status check...
```
