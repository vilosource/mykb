# Storage Architecture Analysis

This document describes how mykb's storage is structured, the separation between layers, and the feasibility of replacing or extending the current backend.

## Three-Layer Architecture

mykb uses a three-layer storage stack. Each layer has a distinct responsibility:

```
  Write path                              Read path
  ---------                               ---------
  MykbStore.addFact(...)                  MykbStore.search(query)
       |                                        |
       v                                        v
  +-----------+                          +-----------+
  | store.ts  |  append-only JSONL       | db.ts     |  SQLite + FTS5
  | (source   |  ~/. mykb/areas/<id>/    | (query    |  ~/.mykb/kb.db
  |  of truth)|  facts.jsonl, etc.       |  engine)  |  (gitignored)
  +-----------+                          +-----------+
       |                                        ^
       | (on startup)                           |
       +----------> hydrate.ts -----------------+
                    rebuilds SQLite from JSONL

  +-----------+
  | save.ts   |  git add -A && git commit
  | (sync)    |  called on `kb save` or session_shutdown
  +-----------+
```

### Layer 1: JSONL File Store (`store.ts`)

**Role**: Source of truth for all knowledge entries.

Each area is a directory under `~/.mykb/areas/<id>/` containing type-specific JSONL files:

```
areas/
  mykb/
    area.json          # area metadata (name, summary, tags)
    facts.jsonl        # one JSON object per line
    decisions.jsonl
    gotchas.jsonl
    patterns.jsonl
    links.jsonl
```

Key characteristics:
- **Append-only**: new entries and updates are appended. Later lines override earlier lines with the same ID (last-write-wins).
- **Tombstones**: deletes are recorded as `{ "id": "...", "deleted": true }` rather than removing lines.
- **Compaction**: `kb compact` rewrites JSONL files, collapsing duplicates and removing tombstones.
- **File**: `src/core/store.ts` (149 lines). Exports: `appendEntry`, `readEntries`, `readAllEntries`, `writeTombstone`, `compactEntries`.

### Layer 2: SQLite Query Index (`db.ts`)

**Role**: Fast reads, full-text search, and filtered queries.

- Uses `better-sqlite3` with FTS5 for full-text search.
- The database file (`kb.db`) is gitignored -- it is a derived cache, not a source of truth.
- On startup, `hydrate.ts` checks if any JSONL file has a newer mtime than the last hydration timestamp. If stale, it rebuilds the entire index from JSONL.
- **File**: `src/core/db.ts`. Exports: `createDatabase`, `upsertEntry`, `deleteEntry`, `queryEntries`, `searchEntries`, `sanitizeFtsQuery`, `upsertArea`, `getAreaStats`.

### Layer 3: Git Persistence (`save.ts`)

**Role**: Version history and sync.

Entire implementation (26 lines):

```typescript
// save.ts
export function save(brainPath, message?) {
  if (!hasChanges(brainPath)) return;
  execSync('git add -A', { cwd: brainPath });
  execSync(`git commit -m "${message}"`, { cwd: brainPath });
}

export function saveAndPush(brainPath, message?) {
  save(brainPath, message);
  execSync('git push', { cwd: brainPath });
}
```

Git is also used in `init.ts` for `git init` (brain initialization) and dirty-shutdown detection (`git status --porcelain`).

## Interfaces and Implementations

### KnowledgeStore

Defined in `types.ts:153-168`. The primary interface for all knowledge operations:

```typescript
interface KnowledgeStore {
  addFact(area, text, options?): string;
  addDecision(area, text, options?): string;
  addGotcha(area, text, options?): string;
  addPattern(area, text, options?): string;
  addLink(area, text, url, options?): string;
  updateEntry(area, id, updates): void;
  deleteEntry(area, id): void;
  verifyEntry(area, id): void;
  promoteEntry(area, id): void;
  archiveEntry(area, id): void;
  loadArea(area, filter?): KnowledgeEntry[];
  search(query): KnowledgeEntry[];
  matchAreas(text): { area; score }[];
  compact(area?): void;
}
```

**Implementation**: `MykbStore` in `knowledge-store.ts`. Dual-writes to both JSONL (`store.ts`) and SQLite (`db.ts`) on every mutation. Reads go exclusively through SQLite.

### WorkspaceStorage

Defined in `types.ts:294-324`. Full interface for workspace lifecycle:

```typescript
interface WorkspaceStorage {
  createWorkspace(id, name, options?): void;
  readWorkspace(id): Workspace | null;
  updateWorkspaceState(id, state): void;
  // ... journal, notes, handoff, artifacts, archive
}
```

**Implementation**: `FileSystemWorkspaceStorage` in `workspace.ts`. Uses JSON files (`workspace.json`) and JSONL files (`journal.jsonl`, `notes.jsonl`) under `~/.mykb/workspaces/<id>/`.

### SearchEngine

Defined in `types.ts:170-173`. A narrow interface for search-only consumers:

```typescript
interface SearchEngine {
  searchEntries(query): KnowledgeEntry[];
  matchAreas(text): { area; score }[];
}
```

## Git Coupling Assessment

Git usage is confined to exactly **two source files**:

| File | Git operations | Called from |
|------|---------------|------------|
| `save.ts` | `git status`, `git add`, `git commit`, `git push` | CLI `kb save` command, extension `session_shutdown` hook |
| `init.ts` | `git init`, `git status` (dirty check), `git add`/`git commit` (recovery) | CLI `kb init` command, `MykbStore.open` (via dirty-shutdown recovery) |

**No other module imports or calls git.** The JSONL store, SQLite index, workspace storage, hydration, rendering, and all business logic are entirely git-unaware.

## Instantiation (No Dependency Injection)

Both entry points hardcode concrete classes:

```typescript
// cli.ts
function withStore<T>(fn: (store: MykbStore) => T): T {
  const store = MykbStore.open(bp);   // hardcoded
  // ...
}

function createWorkspaceStorage(): FileSystemWorkspaceStorage {
  return new FileSystemWorkspaceStorage(bp);  // hardcoded
}

// extension/index.ts
const store = MykbStore.open(brainPath);  // hardcoded
const wsStorage = new FileSystemWorkspaceStorage(brainPath);  // hardcoded
```

There is no factory, strategy pattern, or IoC container.

## Replaceability Summary

| Component | Coupling | Effort to replace | Notes |
|-----------|----------|-------------------|-------|
| **Git** (`save.ts` + `init.ts`) | Isolated, 2 files | Trivial | Delete or swap with any sync mechanism |
| **WorkspaceStorage** | Interface exists | Low | Implement the interface for a new backend |
| **JSONL file store** (`store.ts`) | No interface, used by `MykbStore` directly | Medium | Need to extract a persistence interface from `MykbStore.persistEntry`/`findEntry` |
| **SQLite index** (`db.ts`) | No interface, SQL inline | Medium-High | Need to extract a `QueryEngine` interface; FTS5 queries are scattered through `db.ts` and `knowledge-store.ts` |
| **Full backend swap** | All layers | ~1-2 days | Extract interfaces, add DI to entry points, implement new backend |

### What Would Make It Fully Pluggable

1. **Extract a `PersistenceLayer` interface** from `store.ts` (does not exist today):
   ```typescript
   interface PersistenceLayer {
     appendEntry(area: string, entry: KnowledgeEntry): void;
     readEntries(area: string, type: EntryType): KnowledgeEntry[];
     writeTombstone(area: string, id: string, type: EntryType): void;
     compactEntries(area: string, type?: EntryType): void;
   }
   ```

2. **Extract a `QueryEngine` interface** from `db.ts` (does not exist today):
   ```typescript
   interface QueryEngine {
     upsertEntry(entry: KnowledgeEntry): void;
     deleteEntry(id: string): void;
     queryEntries(filter: EntryFilter): KnowledgeEntry[];
     searchEntries(query: string, excludeZone?: Zone): KnowledgeEntry[];
     getAreaStats(area: string): AreaStats;
   }
   ```

3. **Extract a `SyncAdapter` interface** from `save.ts`:
   ```typescript
   interface SyncAdapter {
     hasChanges(): boolean;
     save(message?: string): void;
     saveAndPush(message?: string): void;
   }
   ```

4. **Inject via factory** in `cli.ts` and `extension/index.ts` rather than hardcoding `new`.

### Design Strength

The current architecture has a clean separation of concerns even without formal interfaces for every layer. The dual-write pattern (JSONL for durability, SQLite for queries) means the source of truth is a simple, portable format (JSONL files in directories) that any backend could produce or consume. The `WorkspaceStorage` interface is already a good model for how the knowledge storage side could be abstracted.
