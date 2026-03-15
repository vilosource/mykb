# mykb Design Status

Date: 2026-03-15

## What We Know

### Problem Statement

AI coding agents start every session from zero. Hard-won knowledge — infrastructure facts, architectural decisions, gotchas, patterns — evaporates between sessions. Developers re-explain the same context repeatedly. Existing solutions (chat history, CLAUDE.md, built-in memory, vector databases) each solve part of the problem but none provide structured, queryable, git-native, provider-agnostic knowledge management.

### Vision

> Skills to work on the brain. Knowledge to work with. Built on Pi, informed by v1.

Two components:
1. **Skills** — The AI knows how to interact with the knowledge base (load, save, query, add). Whatever LLM is used, it knows how to work on the brain.
2. **Knowledge** — The AI has the right context at the right time. Whatever LLM is used, it has the knowledge it needs.

### Target Harness: Pi

mykb is built exclusively for the [Pi coding agent](https://github.com/badlogic/pi-mono). Reasons:
- **Extensibility** — 25+ in-process TypeScript events, tool registration/override, context injection, message interception. Claude Code has 4 subprocess hooks.
- **Provider agnostic** — Anthropic, OpenAI, Google, DeepSeek, Mistral, xAI, Groq, custom providers.
- **Source access** — We have the Pi source code. Can fork if needed.

### Knowledge Model (from OSB v1)

Proven in production across 17 areas and 15 workspaces over months of daily use.

**Areas** — Domains of knowledge that accumulate over time. No end date. Examples: `ci-pipelines`, `networking`, `secrets-management`. Each area has a summary, owner, and related areas.

**Knowledge types:**

| Type | Purpose |
|------|---------|
| Fact | An atomic piece of learned knowledge |
| Decision | An architectural choice with rationale and rejected alternatives |
| Gotcha | A trap or surprising behavior. `[failed]` prefix for rejected approaches |
| Pattern | A reusable technique that worked |
| Link | A pointer to an external resource |

**Provenance** — Every fact carries attribution:

| Status | Meaning |
|--------|---------|
| `verified` | Confirmed true on a date, from a source |
| `unverified` | Captured but not yet confirmed |
| `stale` | Was verified but past freshness threshold |
| `expires` | Time-bound, becomes invalid after a date |

**Zones** — Progressive summarization lifecycle:

| Zone | Meaning |
|------|---------|
| `active` | Recent, frequently referenced (working set) |
| `established` | Stable, multiply-verified (proven knowledge) |
| `archive` | Deprecated or superseded |

**Tags** — Inline labels for sub-area retrieval. A fact can have multiple tags. Enables filtered queries like "networking facts about DNS."

**Cross-area** — Work touches multiple areas simultaneously. Cross-area matching detects which areas are relevant to current work context.

### Storage Format: JSONL + SQLite Hybrid

Pattern proven by Engram (18k stars) and Beads (18k stars):

- **JSONL files per area** (git-tracked, append-only) — the source of truth
- **SQLite + FTS5** (gitignored, hydrated from JSONL on startup) — the query layer
- **Compact markdown** (rendered by CLI) — token-efficient output for LLM context

Update/delete semantics:
- Update: append new line with same `id`, latest entry wins
- Delete: append tombstone `{"id":"x","deleted":true}`
- Compaction: periodic rewrite, collapse to latest versions, remove tombstones

Why this format:
- Git-friendly (append-only merges cleanly, conflict-free)
- Queryable (SQLite + FTS5 for any query pattern)
- Portable (no server, just files + embedded SQLite)
- AI-proof (JSONL is not something the AI naturally tries to edit)
- Rebuildable (SQLite is a cache, regenerated from JSONL anytime)

### Delivery: Three-Tier Context Strategy

Based on Vercel's research showing always-loaded context (100% pass rate) outperforms on-demand skills (53%):

**Tier 1 — Always loaded (system prompt)**
- Area index (ID + one-line summary for each area)
- Kept small (<8KB)
- Injected at session start via Pi's `before_agent_start` or system prompt modification
- Always reliable — the AI always knows what knowledge domains exist

**Tier 2 — Auto-injected (per-turn)**
- Relevant area facts based on what the AI is working on
- Injected via Pi's `context` event before each LLM call
- Extension decides relevance — not the AI, not the user
- The AI cannot ignore it — it's part of the message history

**Tier 3 — On-demand (explicit)**
- Full area deep-dives via `/kb <area>` command
- For when the user knows what they need
- Traditional progressive disclosure

### Enforcement via Pi

Six levels replacing OSB v1's single "nudge and hope" mechanism:

| Level | Pi API | Purpose |
|-------|--------|---------|
| 1. Passive observation | `tool_result`, `turn_end` | Watch and capture knowledge silently |
| 2. Context enrichment | `context` event | Inject relevant facts before each LLM call |
| 3. Nudge | `pi.sendMessage()` | Suggest actions when AI judgment is needed |
| 4. Tool gating | `tool_call` → `{block}` | Block direct edits to knowledge files |
| 5. Result transformation | `tool_result` modification | Modify what the AI sees after tool execution |
| 6. Native tools | `pi.registerTool()` | Brain operations as first-class tools |

### Reference Implementations

**Engram** — Go binary, SQLite + FTS5, gzipped JSONL chunks, MCP server. Agent calls `mem_save` for curated summaries. Philosophy: "Trust the agent to decide what's worth remembering."

**Beads** — JSONL source of truth + SQLite cache. Background daemon syncs. Append-only, conflict-free git merges. Philosophy: "Local-first, git-native."

**OSB v1** — Our predecessor. Proved the knowledge model (areas, provenance, zones, tags). Revealed limitations of Claude Code as a harness (convention-enforced, AI bypasses CLI, nudges ignored). All 17 nudges mapped to Pi's enforcement spectrum.

### Lessons from OSB v1

| What worked | What didn't |
|-------------|------------|
| Knowledge areas as a concept | AI edits BRAIN.md directly — no enforcement possible in Claude Code |
| Provenance tracking | Nudges get ignored — model-dependent compliance |
| Progressive summarization zones | Manual context loading — `osb load` relies on AI remembering |
| Cross-area awareness | Convention-enforced CLI — no mechanical constraint |
| Journal for session breadcrumbs | Subprocess hooks — slow, fragile, limited to JSON message injection |
| Git-backed storage | Markdown format — too accessible, AI treats it as regular file |

---

## What We Don't Know

### 1. Brain Location

Where does `.kb/` live? Options:
- Per-project (next to source code)
- Global (`~/.kb/`)
- Both (global brain with project-local overrides)
- Configurable via environment variable

Related: how does the Pi extension find the brain? Walk up from CWD? Env var? Config file?

### 2. Area Definition Format

How are areas created and configured? What metadata does an area have beyond summary and owner? Is there a central config file or is each area self-describing? What's the formal `.kb/` directory layout?

### 3. JSONL Schema

Formal schema for each knowledge type. Required fields, constraints, validation rules. How do decisions (with `why`, `rejected` fields) differ from facts in the JSONL format? How are links represented? What's the ID generation strategy?

### 4. SQLite Schema

Table design, indexes, FTS5 configuration. How is hydration from JSONL structured? Is it one table or separate tables per knowledge type? What queries need to be fast?

### 5. KB CLI Commands

The command set for the `kb` binary. Simpler than `osb` (no workspaces, journals, instances, container model). Core operations: add, query, list areas, render, compact, init. What's the full taxonomy?

### 6. Context Injection Strategy

How does the Pi extension decide what facts are relevant to inject? Options:
- Keyword matching against area summaries
- File path patterns (reading Terraform → inject cloud-infra area)
- Command patterns (running ansible → inject config-mgmt area)
- Conversation content analysis
- All of the above with weighted scoring

Also: token budget per turn? How much knowledge is too much? What's the cutoff?

### 7. Cross-Area Matching Algorithm

How does `kb match "working on terraform for customer X"` return relevant areas? Options:
- Keyword overlap with area summaries and fact text
- TF-IDF scoring
- Embedding similarity (requires vector support)
- Simple substring matching against summaries

Tradeoff: accuracy vs complexity vs latency.

### 8. Background Observer Design

A secondary process watching the primary agent to decide what knowledge to capture. Open questions:
- Which LLM model? Same provider as primary? Cheaper/faster model?
- Same Pi session or separate process?
- What triggers a capture decision? Every turn? Every N turns? Specific event patterns?
- How does it write to the brain without conflicting with the primary agent?
- Cost and latency implications
- Is this Phase 1 or Phase 2?

### 9. Language Choice

Is the `kb` CLI in Go (like osb, can reuse storage/parsing code) or TypeScript (native to Pi ecosystem, single language for extension + CLI)? Tradeoffs:
- Go: proven storage code from osb, static binary, modernc.org/sqlite (no CGO)
- TypeScript: single language, Pi-native, better-sqlite3 or sql.js

### 10. Pi Extension Packaging

How is mykb distributed and installed?
- npm package (`pi install npm:@vilosource/mykb`)
- Git install (`pi install git:github.com/vilosource/mykb`)
- Manual placement in `~/.pi/agent/extensions/mykb/`
- Pi Package manifest format

What's the extension directory structure?
