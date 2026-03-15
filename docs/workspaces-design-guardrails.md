# Workspace Design Guardrails

These are specific areas where the implementation MUST follow the design exactly. The development manifesto covers general SOLID principles, but these are workspace-specific concerns where shortcuts would create technical debt or block future extensibility.

## 1. No filesystem operations outside WorkspaceStorage

**Risk:** An implementer uses `fs.readFileSync` or `fs.writeFileSync` directly in CLI commands, extension hooks, or tools instead of going through `WorkspaceStorage`.

**Rule:** Only `FileSystemWorkspaceStorage` touches the filesystem. CLI commands, Pi extension hooks, and registered tools receive a `WorkspaceStorage` instance and call its methods. Zero `import fs` in any consumer.

**Why:** If workspace storage moves to Azure Blob or S3, every `fs.readFileSync` becomes a broken reference. The interface abstraction only works if it's the sole access path.

**Check:** grep for `import fs` or `readFileSync` or `writeFileSync` in any file outside `src/core/workspace.ts`. Should find zero hits in workspace-related code.

## 2. No hardcoded paths in consumers

**Risk:** CLI or extension code builds paths like `path.join(brainPath, 'workspaces', id, 'workspace.json')` instead of calling `storage.readWorkspace(id)`.

**Rule:** Path construction belongs exclusively in `FileSystemWorkspaceStorage`. Consumers never know the directory structure. They call `storage.readWorkspace('stark-picking')` and get a `Workspace` object back.

**Why:** Different backends have different path semantics. Filesystem uses directories. Blob storage uses flat keys. The interface hides this.

**Check:** grep for `workspaces/` or `workspace.json` or `journal.jsonl` in any file outside `src/core/workspace.ts`. Should find zero hits.

## 3. Document creation: AI uses write tool, index catches up on save

**Risk:** Designing a `kb_write_doc` tool that goes through `WorkspaceStorage.writeDocument()`, which then conflicts with the AI's natural behavior of using Pi's built-in `write` tool.

**Rule (for filesystem backend):** The AI creates workspace documents using Pi's native `write` tool — files appear in the workspace directory on disk. `WorkspaceStorage.scanDocumentIndex()` picks them up on `kb save` by scanning the directory and reading frontmatter. The `writeDocument` / `readDocument` / `deleteDocument` methods on the interface exist for programmatic use (CLI, migration, future backends) but are NOT the primary path for AI-created documents in the filesystem implementation.

**Why:** Fighting the AI's natural file-writing behavior creates friction. Let the AI write files naturally. The index catches up asynchronously.

**Known tension:** When workspace storage moves to a cloud backend, the AI can't write files to Azure Blob via Pi's `write` tool. At that point, a `kb_write_doc` registered tool will be needed. This is a future concern, not a current one. Document it as a known limitation of the filesystem implementation.

## 4. Active workspace is an interface concern, not a file concern

**Risk:** Extension hooks read `~/.mykb/workspaces/.active` directly instead of calling `storage.getActiveWorkspaceId()`.

**Rule:** Active workspace tracking is a `WorkspaceStorage` method. The `.active` file is an implementation detail of `FileSystemWorkspaceStorage`. A cloud backend might use a different mechanism (API call, database flag, environment variable).

**Check:** grep for `.active` in any file outside `src/core/workspace.ts`. Should find zero hits.

## 5. Journal is part of WorkspaceStorage, not a separate module

**Risk:** Creating a standalone `journal.ts` that independently manages JSONL files, bypassing the storage abstraction.

**Rule:** `appendJournal` and `readJournal` are methods on `WorkspaceStorage`. In `FileSystemWorkspaceStorage`, they read/write `journal.jsonl`. In a future backend, they might use an API or database table. The interface owns the abstraction.

**Note:** The implementation plan originally had `journal.ts` as a separate file. This is fine for code organization within `FileSystemWorkspaceStorage` (internal helper), but the public API must go through the interface.

## 6. Git operations are NOT part of WorkspaceStorage

**Risk:** Putting `git add`, `git commit` inside `WorkspaceStorage` methods, coupling storage to git.

**Rule:** `WorkspaceStorage` handles data CRUD only. Git operations (`kb save`) remain in `src/core/save.ts`, which is called separately. A cloud backend wouldn't use git at all.

**Check:** grep for `execSync.*git` or `child_process` in `src/core/workspace.ts`. Should find zero hits.

## 7. Workspace state updates are partial, not full replacements

**Risk:** `updateWorkspaceState` takes a full `WorkspaceState` and overwrites everything, losing fields the caller didn't intend to change.

**Rule:** `updateWorkspaceState(id, state: Partial<WorkspaceState>)` merges the provided fields with the existing state. If only `phase` is provided, `active`, `blocked`, and `next` are unchanged.

**Why:** The CLI `kb work state --phase "building"` should only update phase. The AI's `kb_work_state` tool might update only `active`. Callers should never need to read-then-write the full state to change one field.

## 8. Workspace archival preserves, not deletes

**Risk:** `archiveWorkspace` deletes the workspace directory.

**Rule:** Archival moves the workspace to an archive location (e.g., `workspaces/archive/<id>/` in the filesystem backend). All data — workspace.json, journal.jsonl, documents — is preserved. The workspace no longer appears in `listWorkspaces()` but can be recovered.

**Why:** Archived workspaces contain project history (journal, decisions, documents) that may be needed later.

## 9. Extension creates WorkspaceStorage once, passes it everywhere

**Risk:** Each tool or hook creates its own `FileSystemWorkspaceStorage` instance.

**Rule:** The extension entry point (`index.ts`) creates ONE `FileSystemWorkspaceStorage` instance and passes it to all hooks and tools via dependency injection. Same pattern as `MykbStore` — created once, shared.

**Why:** Single instance ensures consistent state, proper resource management, and makes future backend swaps a one-line change in `index.ts`.

## Summary checklist

Add these to the phase gates:

- [ ] No `import fs` in workspace consumers (CLI commands, hooks, tools)
- [ ] No hardcoded workspace paths outside `FileSystemWorkspaceStorage`
- [ ] No git operations inside `WorkspaceStorage`
- [ ] `updateWorkspaceState` uses `Partial<WorkspaceState>`
- [ ] `archiveWorkspace` preserves, not deletes
- [ ] Single `WorkspaceStorage` instance shared via DI
- [ ] Active workspace accessed only via interface methods
- [ ] Journal accessed only via interface methods
