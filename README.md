# mykb

> Persistent, structured, git-native knowledge for AI coding agents.
> *Skills to work on the brain. Knowledge to work with.*

[![CI](https://github.com/vilosource/mykb/actions/workflows/ci.yml/badge.svg)](https://github.com/vilosource/mykb/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@vilosource/mykb.svg)](https://www.npmjs.com/package/@vilosource/mykb)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg)](package.json)
[![Built for Pi](https://img.shields.io/badge/built%20for-Pi-8A2BE2.svg)](https://github.com/badlogic/pi-mono)

mykb gives your AI coding agent a memory: a structured, queryable knowledge base that survives across sessions, LLM providers, and machines. Knowledge lives in git-tracked JSONL files; a fast SQLite cache makes it searchable; and a [Pi](https://github.com/badlogic/pi-mono) extension feeds the right facts into the agent's context automatically — without the agent or the user having to ask.

---

## Contents

- [Why mykb](#why-mykb)
- [Install](#install)
- [Quick start](#quick-start)
- [How it works](#how-it-works)
- [Key concepts](#key-concepts)
- [Requirements](#requirements)
- [Documentation](#documentation)
- [Project status](#project-status)
- [Contributing](#contributing)
- [License](#license)
- [Acknowledgements](#acknowledgements)

---

## Why mykb

AI coding agents start every session from zero. They have no memory of prior work, no awareness of infrastructure decisions, no recall of gotchas learned the hard way. Developers re-explain the same context repeatedly, and hard-won knowledge evaporates between sessions.

|                              | Chat history | `CLAUDE.md` / `AGENTS.md` | Built-in agent memory | Vector DB | **mykb** |
|------------------------------|:---:|:---:|:---:|:---:|:---:|
| Structured (not free text)   | ✗ | ~ | ~ | ~ | **✓** |
| Queryable (area / tag / FTS) | ✗ | ✗ | ✗ | ~ | **✓** |
| Git-native, diff-able        | ✗ | ✓ | ✗ | ✗ | **✓** |
| Provider-agnostic            | ✗ | ✓ | ✗ | ✓ | **✓** |
| Auto-injected at the right time | ✗ | ✗ (always on) | ~ | ✗ | **✓** |
| Domain knowledge, not just prefs | ✗ | ~ | ✗ | ✓ | **✓** |
| No server to run             | ✓ | ✓ | ✓ | ✗ | **✓** |

mykb provides two things:

1. **Skills** — whatever LLM you use, it knows *how* to work on the brain: load, save, query, add facts/decisions/gotchas/patterns.
2. **Knowledge** — whatever LLM you use, it *has* the right context at the right time, injected before the call instead of fetched on request.

It's built as a [Pi coding agent](https://github.com/badlogic/pi-mono) extension to take advantage of Pi's deep extensibility — but the `kb` CLI works standalone, and the knowledge model is provider-agnostic (Anthropic, OpenAI, Google, DeepSeek, Mistral, any OpenAI-compatible endpoint).

## Install

### As a Pi extension

```bash
pi install npm:@vilosource/mykb
```

This registers the extension with Pi and installs the `kb` CLI.

### CLI only

```bash
npm install -g @vilosource/mykb
kb --help

# or, without installing
npx @vilosource/mykb --help
```

### From source

```bash
git clone https://github.com/vilosource/mykb.git
cd mykb
npm install
npm run build          # tsc → dist/
npm run bundle:all     # bundle the extension + CLI (for Pi / container use)

# run the CLI from the build
node dist/cli/cli.js --help

# load the extension into Pi directly
pi --extension ./dist/extension      # one-off
# …or add "./dist/extension" to ~/.pi/agent/settings.json "extensions",
#    or to a project's .pi/extensions/, or to a package.json "pi.extensions" field
```

## Quick start

```bash
# Initialize a knowledge brain (default location: ~/.mykb)
kb init

# Add knowledge
kb add fact networking "DNS uses CoreDNS with zone forwarding" --source "docs"
kb add gotcha networking "NAT has asymmetric routing" --source "debugging"
kb add decision ci-pipelines "Use spot instances for runners" \
  --why "60% cost savings" --rejected "On-demand — too expensive"

# Query knowledge
kb load networking          # full area dump (facts, decisions, gotchas, patterns, links)
kb search "DNS"             # full-text search across all areas
kb match "deploying the ingress controller"   # which areas are relevant?
kb list                     # all areas
kb stats                    # entry counts by area

# Workspaces — session-scoped context for a piece of work
kb work create acme-migration "ACME platform migration" --areas networking,ci-pipelines
kb work start acme-migration       # activates it; prints the resume handoff
kb work journal "Finished the DNS cutover; ALB next"
kb work handoff "Cutover done. Next: switch the ALB target group, then smoke-test."

# Cold-start helper — what did I touch lately, across all workspaces/areas?
kb recent          # last 2 days
kb recent -d 7     # last week
kb recent --all --git

# Commit the brain (it's a git repo)
kb save            # or: kb save --push
```

Run `kb --help` for the full command reference, or see [`docs/`](docs/).

## How it works

### Knowledge organization

Knowledge is organized into **areas** — domains of expertise that accumulate entries over time (`ci-pipelines`, `secrets-management`, `networking`, `customer-acme`, …). Areas have no end date; they grow as you learn. Each area holds **entries** — atomic, individually-addressable units, each with its own provenance, tags, and lifecycle zone. Entry kinds: **facts**, **decisions** (with rationale + rejected alternatives), **gotchas** (traps, optionally `[failed]`), **patterns** (reusable techniques), and **links**.

### Three-tier context delivery

| Tier | When | What | Footprint |
|------|------|------|-----------|
| **1 — Always loaded** | session start | area summaries injected into the system prompt — the AI always knows which knowledge domains exist | small (<8 KB) |
| **2 — Auto-injected** | before each LLM call | the Pi extension watches file paths, commands, and conversation content, and injects the relevant entries — no request needed | bounded by a token budget |
| **3 — On-demand** | explicit | full area deep-dive via the `/kb <area>` command | as large as the area |

### Storage architecture

A **JSONL + SQLite hybrid** — a pattern proven by projects like [Engram](https://github.com/Gentleman-Programming/engram) and [Beads](https://github.com/steveyegge/beads):

- **JSONL files** (git-tracked) — one line per entry, append-only. The source of truth. Merges cleanly in git, conflict-free.
- **SQLite + FTS5** (gitignored) — local query cache, hydrated from JSONL on startup. Fast lookups by area, tag, status, full-text. Rebuildable from JSONL at any time (`kb rebuild`).
- **Compact markdown** (rendered by the CLI) — token-efficient output format for LLM context injection.

Deletes are **tombstones** (append-only), and **compaction** (`kb compact`) periodically rewrites the JSONL to collapse versions and drop tombstones — like `git gc`.

### Enforcement via Pi

mykb uses Pi's extension API to enforce the knowledge workflow *mechanically*, not by convention:

| Level | Mechanism | Effect |
|-------|-----------|--------|
| Passive observation | watch tool calls and results | capture knowledge silently in the background |
| Context enrichment | inject entries before each LLM call | the AI has knowledge without asking |
| Tool gating | block direct edits to knowledge files | redirect to the proper `kb` commands |
| Native tools | brain operations as first-class Pi tools | no CLI subprocess, no command syntax to remember |

## Key concepts

| Term | Meaning |
|------|---------|
| **Area** | A domain of knowledge that accumulates entries over time. No end date. |
| **Entry** | The atomic unit of knowledge — a fact, decision, gotcha, pattern, or link. Has an ID, tags, provenance, and a zone. |
| **Provenance** | When and how an entry was verified: `verified`, `unverified`, `stale`, `expires`. |
| **Zone** | Lifecycle stage: `active` (recent working set), `established` (stable, proven), `archive` (deprecated). |
| **Tag** | An inline label for sub-area retrieval; an entry can have several. Enables queries like "networking entries about DNS". |
| **Workspace** | Session-scoped context for a piece of work — links a set of areas, carries a journal and a resume handoff so the next session starts warm. |
| **Tombstone** | A JSONL entry marking another as deleted (append-only semantics). |
| **Compaction** | Periodic JSONL rewrite that collapses versions and removes tombstones. |

## Requirements

- **Node.js ≥ 20**
- **git** (the brain is a git repository)
- For the extension features: a [Pi](https://github.com/badlogic/pi-mono) install. The `kb` CLI alone has no Pi dependency.

`better-sqlite3` (a native module) is the only non-trivial dependency; `npm install` builds it for your platform.

## Documentation

- **Architecture & design** — see [`docs/`](docs/) ([`docs/README.md`](docs/README.md) is the index). Highlights: the architecture diagrams, the storage-architecture analysis, the workspaces design, the three-tier delivery rationale.
- **Development methodology** — [`docs/development-MANIFESTO.md`](docs/development-MANIFESTO.md) (strict TDD + a four-layer test pyramid) and [`docs/experimentation-METHODOLOGY.md`](docs/experimentation-METHODOLOGY.md) (the Layer-4 behavioral-validation harness).
- **Quality** — [`docs/experiment-coverage.md`](docs/experiment-coverage.md) and [`docs/findings-log.md`](docs/findings-log.md): the behavioral test matrix, and an honest log of every latent bug and methodology lesson found while building it.
- **Migrating from OSB v1** — [`docs/osb-migration-GUIDE.md`](docs/osb-migration-GUIDE.md).

## Project status

**Alpha.** The `kb` CLI and the Pi extension work end-to-end — 580+ unit tests, plus a Layer-4 behavioral-validation suite that exercises the extension against a real Pi runtime. APIs, the storage format, and command surface may still change before 1.0.

mykb builds on lessons from [OSB v1](https://github.com/vilosource/osb), which implemented a similar knowledge model on Claude Code — proving the model while revealing the limits of a less extensible harness.

## Contributing

Contributions are welcome — but mykb has a couple of non-obvious conventions (strict TDD, a Layer-4 experiment requirement for behavioral changes, `develop` as the default branch). Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a PR. By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). Security issues: see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © vilosource

## Acknowledgements

- [Pi](https://github.com/badlogic/pi-mono) by Mario Zechner — the coding-agent harness mykb extends.
- [Engram](https://github.com/Gentleman-Programming/engram) and [Beads](https://github.com/steveyegge/beads) — prior art for the JSONL + SQLite hybrid storage pattern.
- [OSB v1](https://github.com/vilosource/osb) — the predecessor that proved the knowledge model.
