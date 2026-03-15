# mykb

> Skills to work on the brain. Knowledge to work with.

## Installation

### As a Pi extension
```bash
pi install npm:@vilosource/mykb
```

### CLI only
```bash
npx @vilosource/mykb --help
# or
npm install -g @vilosource/mykb
kb --help
```

## Quick Start

```bash
# Initialize a knowledge brain
kb init

# Add knowledge
kb add fact networking "DNS uses CoreDNS with zone forwarding" --source "docs"
kb add gotcha networking "NAT has asymmetric routing" --source "debugging"
kb add decision ci-pipelines "Use spot instances for runners" --why "60% cost savings" --rejected "On-demand — too expensive"

# Query knowledge
kb load networking
kb search "DNS"
kb list
kb stats

# Save to git
kb save
```

## What is mykb?

mykb is a knowledge management system for AI coding agents. It gives your AI persistent, structured, queryable knowledge that survives across sessions, providers, and machines.

### The Problem

AI coding agents start every session from zero. They have no memory of prior work, no awareness of infrastructure decisions, no recall of gotchas learned the hard way. Developers re-explain the same context repeatedly, and hard-won knowledge — facts about your infrastructure, decisions about your architecture, traps you've already fallen into — evaporates between sessions.

Existing solutions fall short:

- **Chat history** — unstructured, grows without bound, not queryable
- **CLAUDE.md / AGENTS.md** — static instruction files, not a living knowledge base
- **Built-in memory** (Claude Code, etc.) — behavioral preferences only, no domain knowledge, locked to one provider
- **Vector databases** — require running servers, no git history, opaque retrieval

### The Solution

mykb provides two things:

1. **Skills** — The AI knows how to interact with the knowledge base. Load, save, query, add facts. Whatever LLM is used, it knows how to work on the brain.
2. **Knowledge** — The AI has the right context at the right time. Whatever LLM is used, it has the knowledge it needs.

mykb is built as a [Pi coding agent](https://github.com/badlogic/pi-mono) extension, taking advantage of Pi's deep extensibility to go beyond what's possible with subprocess hooks. It is LLM provider-agnostic — works with Anthropic, OpenAI, Google, DeepSeek, Mistral, and any OpenAI-compatible provider.

### What makes mykb different

- **Structured knowledge, not chat logs** — facts with provenance, not unstructured conversation history
- **Queryable** — load facts by area, tag, status, age, or full-text search
- **Git-native** — knowledge lives in append-only JSONL files, version-controlled like code
- **Provider-agnostic** — works with any LLM through Pi's multi-provider support
- **Automatic context injection** — relevant knowledge appears in context without the AI or user asking for it
- **Mechanical enforcement** — the AI cannot bypass the knowledge system by editing files directly

## How it works

### Knowledge Organization

Knowledge is organized into **areas** — domains of expertise that accumulate facts over time. An area might be `ci-pipelines`, `secrets-management`, `networking`, or `customer-acme`. Areas have no end date — they grow as you learn.

Each area contains **facts** — atomic units of knowledge, individually addressable, each with its own provenance, tags, and lifecycle zone.

### Three-Tier Context Delivery

mykb uses three tiers to get the right knowledge to the AI at the right time:

**Tier 1 — Always loaded:** Area summaries are injected into the system prompt at session start. The AI always knows what knowledge domains exist. Small footprint (<8KB).

**Tier 2 — Auto-injected:** The Pi extension watches what the AI is working on — file paths, commands, conversation content — and automatically injects relevant facts into context before each LLM call. The AI doesn't ask for it. The knowledge is just there.

**Tier 3 — On-demand:** Full area deep-dives via `/kb <area>` command. For when you know what you need or want the complete picture.

### Storage Architecture

mykb uses a **JSONL + SQLite hybrid** — a pattern proven by projects like [Engram](https://github.com/Gentleman-Programming/engram) and [Beads](https://github.com/steveyegge/beads):

- **JSONL files** (git-tracked) — one line per fact, append-only. The source of truth. Merges cleanly in git, conflict-free.
- **SQLite + FTS5** (gitignored) — local query cache, hydrated from JSONL on startup. Fast lookups by area, tag, status, full-text. Rebuildable from JSONL at any time.
- **Compact markdown** (rendered by CLI) — token-efficient output format for LLM context injection.

### Enforcement via Pi

mykb uses Pi's extension API to enforce the knowledge workflow mechanically, not by convention:

| Level | Mechanism | What it does |
|-------|-----------|-------------|
| Passive observation | Watch tool calls and results | Capture knowledge silently in the background |
| Context enrichment | Inject facts before each LLM call | AI has knowledge without asking |
| Tool gating | Block direct edits to knowledge files | Redirect to proper `kb` commands |
| Native tools | Brain operations as first-class Pi tools | No CLI subprocess, no command syntax to remember |

## Key Concepts

### Core

| Term | Definition |
|------|-----------|
| **Area** | A domain of knowledge — a subject that accumulates facts over time. Examples: `ci-pipelines`, `secrets-management`, `networking`. No end date. |
| **Fact** | The atomic unit of knowledge. A single piece of information with its own ID, tags, provenance, and zone. |
| **Provenance** | Attribution of when and how a fact was verified. Statuses: `verified`, `unverified`, `stale`, `expires`. |
| **Zone** | The lifecycle stage of a fact: `active` (recent, working set), `established` (stable, proven), `archive` (deprecated). |
| **Tag** | An inline label for sub-area retrieval. A fact can have multiple tags. Enables queries like "networking facts about DNS." |
| **Cross-area** | The relationship between areas. Work often touches multiple areas — cross-area matching detects which are relevant. |

### Knowledge Types

| Type | Definition |
|------|-----------|
| **Decision** | An architectural or design choice with rationale — what was chosen, why, and what was rejected. |
| **Gotcha** | A trap or surprising behavior. Can be `[failed]` to mark approaches tried and rejected. |
| **Pattern** | A reusable technique or approach that worked. |
| **Link** | A pointer to an external resource — URL, file path, wiki page. |

### Storage

| Term | Definition |
|------|-----------|
| **JSONL** | JSON Lines — one JSON object per line. Append-only, git-tracked. The source of truth. |
| **SQLite cache** | Local database with FTS5 search, gitignored. The query layer. Rebuildable from JSONL. |
| **Tombstone** | A JSONL entry marking a fact as deleted. Append-only semantics — deletes are appended, not removed. |
| **Compaction** | Periodic JSONL rewrite — collapses versions, removes tombstones. Like `git gc`. |

### Delivery

| Term | Definition |
|------|-----------|
| **Tier 1** | Always-loaded area summaries in system prompt. Small, reliable. |
| **Tier 2** | Auto-injected facts via Pi's `context` event. Based on work context, not explicit request. |
| **Tier 3** | On-demand full area load via `/kb` command. Explicit user or AI action. |
| **Context enrichment** | Pi's `context` event modifies message history before each LLM call, inserting relevant facts. |
| **Background observer** | A secondary process watching the primary agent to decide what knowledge to capture silently. |

## Status

mykb is in the design and specification phase. It builds on lessons learned from [OSB v1](https://github.com/vilosource/osb), which implemented a similar knowledge system on Claude Code — proving the knowledge model while revealing the limitations of a less extensible harness.

## License

MIT
