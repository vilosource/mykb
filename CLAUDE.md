# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## `kb` vs `kb-develop` — never use the under-development CLI on the real brain

**Operator activity** against the real `~/.mykb` brain (recording journal, handoff, gotchas, `kb save`, etc.) **must use `kb`** — the global binary npm-linked from `~/GitHub/mykb-stable/` (a git worktree pinned at the latest release tag, detached HEAD).

**Development of mykb itself** uses **`kb-develop`** — a wrapper at `~/.local/bin/kb-develop` that runs the feature-branch CLI from `~/GitHub/mykb/dist/cli/cli.js`. Use it only against experiment-instance brain clones (`~/.mykb-experiments/<id>/`) or temp dirs in unit/CLI tests. Never against the real `~/.mykb`.

**Why**: the under-development branch may have unreleased changes whose workspace-ops or entry-add paths haven't been validated against production data. Pinning the stable tree at a release tag (rather than tracking `develop`) means the operator brain only sees CHANGELOG-vetted changes; the kb-spike harness already isolates its container-side work via the captured CLI, and this convention extends the same discipline to the developer's host shell.

**Maintenance**: when a new release is cut (release-please merges its release PR on `develop` and tags `vX.Y.Z`), refresh the stable tree to that tag:

```bash
cd ~/GitHub/mykb-stable
git fetch --tags
git checkout $(git tag --sort=-v:refname | head -n1)   # or: git checkout vX.Y.Z
npm install
npm run build && npm run bundle && npm run bundle:cli
```

The `npm link` survives checkout; only re-link if something explicitly broke it (`cd ~/GitHub/mykb-stable && npm link`).

This convention is recorded as kb decision `bvWRQwIk` on the `mykb` area and as a Claude Code memory entry (`feedback_kb_vs_kb_develop_split.md`).

## Branches

- **`develop`** — the integration branch and GitHub's default. CI (`.github/workflows/ci.yml`) runs on pushes/PRs to `develop`. There is no `main` on the remote; `develop` is it. release-please (`.github/workflows/release-please.yml`) watches `develop` and opens a `chore(develop): release X.Y.Z` PR aggregating conventional-commit history; merging that PR tags `vX.Y.Z` and creates a GitHub Release.
- **Release tags (`vX.Y.Z`)** — the `~/GitHub/mykb-stable` worktree is pinned at the latest tag (detached HEAD) and backs the global `kb` binary. See the `kb` vs `kb-develop` section above for the refresh procedure.
- **Feature branches** — short-lived, branched off `develop`, merged back via fast-forward (or PR for larger changes), then **deleted** (local *and* remote). The `~/GitHub/mykb` worktree is the dev checkout — it sits on whatever feature branch is currently in flight (it can freely check out `develop` too, since `mykb-stable` is on a detached tag and no longer holds the `develop` branch reservation). `kb-develop` runs from `~/GitHub/mykb/dist/`.
- **Live design branches** — `feature/v2-design-docs` and `research/v2-harness-memory` carry v2 design/research work not yet on `develop`; leave them alone.
- The pre-2026-05-11 leftover `feature/*` / `phase-w*` / `docs/*` branches (whose work was already integrated into `develop`) were deleted on 2026-05-11 as part of GH issue #3. Don't recreate the pattern: delete a feature branch once its work lands on `develop`.

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

## Issue tracking — hybrid model

Work is tracked in the place where it's best surfaced. Don't collapse everything into one system, and keep the systems cross-linked so they don't drift.

- **GitHub Issues + the `mykb` Project board** (`vilosource/mykb`, project [#2](https://github.com/users/vilosource/projects/2)) — cross-cutting and architectural backlog: v2 design work, infra/tooling debt, branch/merge decisions, anything without a natural home in an `EXPERIMENT.md`. A GH issue that mirrors an in-repo item must link to it (and the in-repo doc links back).
- **`experiments/<feature>/EXPERIMENT.md` behavior matrices** — per-experiment status; the `🐛 KNOWN-FAIL` rows *are* the issue and its regression home. Indexed by `docs/experiment-coverage.md`.
- **kb gotchas on the `mykb` area** — methodology gotchas and resolved-bug history.
- **The `mykb` workspace handoff** (`kb work handoff`) — near-term session priorities; read on `kb work start mykb`.

When you finish something tracked in two places, update both (close the GH issue *and* flip the `EXPERIMENT.md` row / clear the handoff item). Recorded as kb decision `Iw3j51Sr` on the `mykb` area and as a Claude Code memory entry (`project_mykb_hybrid_issue_tracking.md`).

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
