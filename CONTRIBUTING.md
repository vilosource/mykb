# Contributing to mykb

Thanks for your interest in mykb. This project has a few conventions that aren't obvious from the code — please skim this before opening an issue or PR.

## Code of Conduct

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). Report unacceptable behavior to the maintainers.

## Ways to contribute

- **Bug reports** — open an issue using the bug template. Include the `kb`/`pi` versions, OS, and a minimal repro.
- **Feature requests** — open an issue using the feature template. Explain the problem first, then the proposed solution.
- **Pull requests** — see the workflow below. Small, focused PRs are far easier to review than large ones.
- **Documentation** — fixes and clarifications to `README.md` / `docs/` are always welcome and don't need an issue first.

## Development setup

```bash
git clone https://github.com/vilosource/mykb.git
cd mykb
npm install            # builds better-sqlite3 for your platform
npm run build          # tsc → dist/
npm test               # vitest — the full unit + integration suite
npm run lint           # eslint + prettier --check
```

To work on the Pi extension, build it and point Pi at the build:

```bash
npm run bundle:all
pi --extension ./dist/extension          # one-off
# …or add ./dist/extension to ~/.pi/agent/settings.json, a project .pi/extensions/, etc.
```

**Requirements:** Node.js ≥ 20, git. The `kb` CLI has no Pi dependency; only the extension features do.

## Branch model

- **`develop`** is the default and integration branch. CI runs on pushes and PRs to `develop`. **Open PRs against `develop`, not `main`.**
- **Feature branches** are short-lived, branched off `develop`, named `feature/<topic>` (or `fix/<topic>`, `docs/<topic>`), and deleted after merge.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `test:`, `refactor:`, `docs:`, `chore:`. Do **not** add AI-assistant attribution trailers (`Co-Authored-By: …`, "Generated with …") to commits — note AI involvement in the PR description instead.

## The development manifesto (please read this)

mykb is developed under a **mandatory** [development manifesto](docs/development-MANIFESTO.md). The headline rules:

1. **Strict TDD** — every behavioral change starts with a failing test (RED), then the minimum code to pass (GREEN), then optional REFACTOR. No implementation code without a test driving it. PRs that add behavior without tests will be asked to add them.
2. **Four-layer test pyramid:**
   - **L1 Unit** (`tests/core/`, `tests/extension/`, `tests/tools/`) — exact assertions, deterministic, never flaky. Use the `withTempBrain` helper; never touch a real brain.
   - **L2 CLI integration** (`tests/cli/`) — commands through the real CLI binary; assert output *and* side effects.
   - **L3 E2E isolation** (`tests/`) — concurrent access, multi-instance state, cross-process behavior. Required when a change touches locking, session state, or process boundaries.
   - **L4 Behavioral** (`experiments/`) — LLM-facing behavior validated against a real Pi runtime via the kb-spike harness. Required when a change affects what the LLM sees or how it's nudged. See [`docs/experimentation-METHODOLOGY.md`](docs/experimentation-METHODOLOGY.md) and [`experiments/README.md`](experiments/README.md). Behavioral matrices must include scenarios whose *stimulus* is a naturalistic user prompt and whose *assertion* is the LLM's tool/citation choice — "the data block appears in the system prompt" is an L1 assertion, not an L4 one.
3. **Findings log** — when you discover a latent bug or a methodology lesson while working, add a row to [`docs/findings-log.md`](docs/findings-log.md) (and, for project maintainers, a `kb` gotcha) and reference it from the commit.
4. **No scope creep** — a bug fix doesn't need surrounding cleanup; a one-shot change doesn't need a new abstraction. Keep diffs minimal.

If a change is *not* behavioral (a refactor, a docs edit, a build tweak), the L1/L2 suite passing is enough — but say so in the PR.

## Pull request checklist

Before requesting review:

- [ ] `npm test` passes (full suite — pre-existing flakes are blockers, flag them if you hit one)
- [ ] `npm run lint` passes
- [ ] `npm run build` succeeds
- [ ] New behavior is covered by tests at the appropriate layer(s)
- [ ] Behavioral changes have an L4 experiment scenario (or a written justification for why not)
- [ ] `docs/findings-log.md` updated if you found a bug or methodology lesson
- [ ] Conventional-commit messages; no AI attribution trailers
- [ ] PR description explains the *why*, not just the *what*

CI must be green before a PR can merge. A maintainer will review; expect questions about test coverage and scope.

## Reporting security issues

Please do **not** open a public issue for security vulnerabilities. See [SECURITY.md](SECURITY.md).

## Questions

Open a [discussion](https://github.com/vilosource/mykb/discussions) or an issue. We're happy to help you get oriented.
