# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Rules

**Read `docs/development-MANIFESTO.md` before writing any code.** It is mandatory and governs:
- TDD protocol (RED/GREEN/REFACTOR)
- Testing pyramid (4 layers: unit, CLI integration, E2E isolation, behavioral)
- Change type → test requirements mapping (which layers are mandatory for which changes)
- Feature completion checklist
- Anti-patterns to avoid

**Read `docs/experimentation-METHODOLOGY.md` before implementing any Layer-4 feature.** Layer-4 features (hooks, context injection, scorer changes, signal capture, side-effect counters — anything observable only in the full Pi+brain loop) require a versioned experiment in `experiments/<feature>/` with a behavior matrix and prepare/stimulate/observe scenarios. The kb-spike harness at `scripts/spike/` runs scenarios against an isolated brain instance cloned from `~/.mykb`. The methodology doc is mandatory; the manifesto's Layer 4 points at it.

Key rules that are easy to miss:
- **Shared mutable state requires E2E isolation tests.** If your change touches files or resources accessed by multiple processes (e.g., `.active` file, session files, workspace state), unit tests are not sufficient. Write concurrent-access E2E tests through the real CLI.
- **LLM-facing output requires behavioral validation.** Context delivery, area index, rendered markdown — test the quality, not just the structure. For hook-level behaviors, that means a kb-spike experiment, not a unit-test string match.
- **Combined RED+GREEN commits are OK for small changes** (<50 lines implementation), but never across features.
- **The kb-spike harness control plane never calls `kb` directly.** Only scenarios call kb, and they call the per-experiment captured build (`<instance>/.e2e-build/cli.js`), not the host's `kb`. This keeps the harness usable when kb itself is broken on the working tree.

## Build and Test

```bash
npm run build                                      # TypeScript compilation
npm test                                           # All tests (vitest)
npx vitest run tests/core/workspace.test.ts        # Single file
npx vitest run tests/cli/ -t "creates a workspace" # Single test by name
npm run lint                                       # ESLint + Prettier
npm run bundle                                     # esbuild Pi extension bundle
npm run bundle:cli                                 # esbuild CLI bundle
```

## Architecture

mykb is a TypeScript knowledge management system with two interfaces:
- **CLI** (`src/cli/`) — `kb` command, invoked directly or via Pi/Claude Code
- **Pi Extension** (`src/extension/`) — hooks, tools, and context delivery for the Pi coding agent

Both share a **core library** (`src/core/`) that handles all data operations:

```
src/core/          → Knowledge store, workspace storage, SQLite/FTS5, JSONL I/O
src/cli/           → Commander.js CLI wiring (thin wrapper over core)
src/extension/     → Pi extension hooks, scorer, context injection (thin wrapper over core)
```

**Storage model:** JSONL files (git-tracked, append-only, source of truth) + SQLite FTS5 (gitignored, cache, rebuildable via `kb rebuild`). Dual-write on every operation.

**Workspace isolation:** `KB_SESSION_ID` env var enables per-session active workspace tracking via temp files at `os.tmpdir()/.mykb-session-<id>`. Falls back to `~/.mykb/workspaces/.active` when not set. See `docs/session-isolation-DESIGN.md`.

## Commit Discipline

- Conventional commits: `test:`, `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`
- No AI attribution in commits
- No emojis in commit messages
