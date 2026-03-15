# Storage Format — Research Report

Date: 2026-03-15

## The Question

What is the best storage format for mykb? We need structured, queryable, git-friendly knowledge storage with fact-level granularity.

## Requirements

- **Queryable** — load facts by area, tag, provenance status, age, zone
- **Machine-writable** — a CLI/extension writes it, not a text file the AI edits directly
- **Fact-level granularity** — individual facts are addressable entities
- **Git-friendly** — diffable, mergeable, human-reviewable
- **Portable** — works without a running database server
- **LLM-readable** — output format fed to the AI must be clean and token-efficient

---

## How Other Systems Do It

### Mem0 (mem0.ai) — Hybrid vector + graph + key-value

Mem0 uses a three-layer store: vector embeddings for semantic retrieval, graph database for relational structures, and key-value for fast lookups. Hierarchical memory at user, session, and agent levels. Achieves 26% improvement over baseline and 91% lower latency.

**Tradeoff:** Requires running servers (vector DB, graph DB). Not portable, not git-friendly. Optimized for cloud-scale, not single-developer knowledge.

### Letta/MemGPT — Tiered memory with database persistence

Letta uses OS-inspired memory hierarchy: in-context core memory (always loaded), archival memory (vector DB for overflow), recall memory (conversation history). All state persisted in a database — never lost. The agent modifies its own memory through tool calls.

**Tradeoff:** Requires database server. Not git-friendly. But the tiered model (core + archival) maps well to our Active/Established/Archive zones.

### Engram — SQLite + FTS5 with gzipped JSONL chunks

Engram is the closest match to our needs. Architecture:
- `.engram/manifest.json` — small index, git-trackable
- `.engram/chunks/*.jsonl.gz` — gzipped JSONL, append-only, git-friendly (binary, no diff noise)
- `.engram/engram.db` — gitignored local SQLite with FTS5 for queries
- Pure Go binary (modernc.org/sqlite), no CGO, cross-platform
- Agent calls `mem_save` to persist curated summaries, not raw tool calls
- MCP server for integration with any agent

**Key insight from Engram:** "Trust the agent to decide what's worth remembering — not a firehose of raw tool calls."

### Beads — JSONL source of truth + SQLite cache

Beads uses a similar hybrid:
- `issues.jsonl` — append-only, committed to git (the source of truth)
- `beads.db` — local SQLite hydrated on startup from JSONL (the query layer)
- Background daemon syncs SQLite → JSONL on changes
- Conflict-free git merges because JSONL is append-only

**Key insight from Beads:** Source of truth is text (git-trackable), performance layer is database (gitignored). Best of both worlds.

---

## Storage Format Analysis

### Option 1: JSONL + SQLite (Recommended)

```
.kb/
├── manifest.json           # area index, metadata (git-tracked)
├── areas/
│   ├── ci-pipelines.jsonl  # one line per fact (git-tracked, append-only)
│   ├── secrets.jsonl
│   └── customer-acme.jsonl
├── kb.db                   # SQLite + FTS5 (gitignored, hydrated from JSONL)
└── config.yaml             # area definitions, tags, relations
```

Each JSONL line is a self-contained fact:
```json
{"id":"a1b2c3d4","area":"ci-pipelines","type":"fact","text":"CI runners use autoscaling VM pools with spot instances","tags":["runners","cloud"],"provenance":{"status":"verified","date":"2026-03-15","source":"cloud-cli"},"zone":"active","created":"2026-03-10","updated":"2026-03-15"}
```

**Pros:**
- Git-friendly: append-only JSONL diffs cleanly, merges without conflict
- Queryable: SQLite + FTS5 for tag/area/status/full-text queries
- Portable: no server needed, SQLite is embedded
- Fact-level granularity: each line is one fact with its own ID
- Machine-writable: structured JSON, not free-form markdown
- Rebuildable: SQLite can be regenerated from JSONL at any time
- Proven pattern: used by Engram (18.7k stars) and Beads (18.7k stars)

**Cons:**
- Not human-readable in raw form (JSONL is dense)
- Requires a CLI to read/write (can't just open in an editor)
- Deletes/updates require tombstone pattern or rewrite (append-only constraint)

**Mitigation for cons:**
- `kb render <area>` command produces human-readable markdown output
- The CLI IS the interface — humans shouldn't edit knowledge files directly (that's the whole point)
- Updates append a new version; compaction rewrites periodically

### Option 2: YAML files (one per area)

**Pros:** Human-readable, git-friendly, structured.
**Cons:** Git merge conflicts on concurrent edits, no full-text search, scales poorly past ~100 facts per file.

### Option 3: SQLite only

**Pros:** Full query power, single file, excellent scale.
**Cons:** Binary (not git-diffable), merge conflicts impossible, not human-readable.

### Option 4: One file per fact (Claude memory style)

**Pros:** Independently versionable, clean diffs.
**Cons:** Filesystem bloat at scale, no query capability, slow to load, git performance degrades with many small files.

### Option 5: Markdown + frontmatter (OSB v1 BRAIN.md)

**Pros:** Familiar, human-readable.
**Cons:** AI edits it directly, fragile regex parsing, no query capability. This is what we're improving on.

---

## Token Efficiency for LLM Context

The storage format doesn't need to match the output format. The CLI renders facts into the most token-efficient format for LLM consumption.

Research findings on token efficiency:
- **Markdown** is the most token-efficient format overall
- **YAML** is 18% more token-efficient than formatted JSON
- **JSON (minified)** is most efficient for nested/complex data
- **TOON** (Token Oriented Object Notation) saves 40% on flat tabular data

**Recommendation:** Store in JSONL (structured, queryable). Render to **compact markdown** for LLM injection:

```markdown
## ci-pipelines (Active)
- CI runners use autoscaling VM pools with spot instances #runners #cloud (verified:2026-03-15)
- Container registry at registry.example.com #registry (verified:2026-03-10)
```

This is the most token-efficient output format while remaining readable. The storage format (JSONL) is invisible to the LLM.

---

## Scale Analysis

Starting scale: ~17 areas, 10-50 facts each, ~500 total facts.
Growth target: 50+ areas, 5000-10000 facts over years.

| Scale | Flat files | JSONL + SQLite | SQLite only |
|-------|-----------|----------------|-------------|
| 500 facts | fine | overkill but works | overkill |
| 2000 facts | getting slow | comfortable | comfortable |
| 5000 facts | painful | comfortable | comfortable |
| 10000+ facts | broken | comfortable | comfortable |

JSONL + SQLite is comfortable at all scales we'll encounter.

---

## Recommendation: JSONL + SQLite Hybrid

**Source of truth:** JSONL files per area (git-tracked, append-only)
**Query layer:** SQLite + FTS5 (gitignored, hydrated from JSONL on startup)
**Output format:** Compact markdown rendered by CLI for LLM consumption

This gives us:

1. **Git-friendly** — append-only JSONL merges cleanly
2. **Queryable** — SQLite + FTS5 for any query pattern
3. **Portable** — no server, just files + embedded SQLite
4. **Machine-writable** — structured JSON, not free-form text
5. **AI-proof** — JSONL files are not something the AI would naturally try to edit (unlike markdown)
6. **Rebuildable** — SQLite is a cache, can be regenerated from JSONL anytime
7. **Token-efficient output** — render to compact markdown for LLM injection

### Update/Delete semantics

Since JSONL is append-only:
- **Update:** Append a new line with the same `id` and updated fields. Latest entry wins.
- **Delete:** Append a tombstone `{"id":"x","deleted":true}`
- **Compaction:** Periodic `kb compact` rewrites JSONL with only latest versions, removes tombstones

This mirrors git's own model — history is append-only, gc compacts.

---

## Sources

- [Engram — Persistent memory for AI coding agents](https://github.com/Gentleman-Programming/engram)
- [Beads — Memory for your coding agent](https://github.com/steveyegge/beads)
- [Mem0 — Graph Memory for AI Agents](https://mem0.ai/blog/graph-memory-solutions-ai-agents)
- [Letta/MemGPT — Understanding memory management](https://docs.letta.com/advanced/memory-management/)
- [Mem0 Research Paper](https://arxiv.org/abs/2504.19413)
- [TOON vs JSON vs YAML Token Efficiency](https://medium.com/@ffkalapurackal/toon-vs-json-vs-yaml-token-efficiency-breakdown-for-llm-5d3e5dc9fb9c)
- [YAML vs JSON for Language Models](https://betterprogramming.pub/yaml-vs-json-which-is-more-efficient-for-language-models-5bc11dd0f6df)
- [Best Nested Data Format for LLMs](https://www.improvingagents.com/blog/best-nested-data-format/)
- [SQLite FTS5 Extension](https://www.sqlite.org/fts5.html)
- [King-Context — Token efficient context with SQLite FTS5](https://github.com/deandevz/king-context)
- [Beads Technical Architecture](https://medium.com/google-cloud/the-beads-memory-system-technical-architecture-and-integration-with-gemini-cli-for-agentic-c2aa36430802)
- [Building Persistent Memory for AI Agents with Go](https://dasroot.net/posts/2026/02/building-persistent-memory-ai-agents-go-beads/)
