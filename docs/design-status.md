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
| Gotcha | A trap or surprising behavior. Structured `failed` flag and `resolution` status |
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
- Area index: ID + one-line summary for each area (from manifest.json)
- Summaries only, no facts — just enough for the AI to know what domains exist
- Kept small (<8KB). At 17 areas with one-line summaries, this is ~500 tokens.
- Injected at session start via Pi's `before_agent_start` system prompt modification
- Always reliable — the AI always knows what knowledge domains are available for Tier 2/3 loading

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

### OSB v1 Area Pain Points (informing mykb improvements)

From code review of the OSB v1 area implementation:

1. **Zone migration is manual** — no API for promoting facts from active to established
2. **Single owner per area** — no multi-owner support
3. **Provenance is single-source** — a fact can have one source only, no multi-source lineage
4. **No fact versioning** — no way to track how a fact changed over time without manually editing
5. **Decision log split** — decisions appear inline AND in a separate decisions.md file (two sources of truth)
6. **No fact relationships** — can't express "Fact A depends on Fact B" or "contradicts Fact C"
7. **Gotchas lack resolution status** — `[failed]` prefix exists but no formal resolved/mitigated/wontfix
8. **Hard to bulk-update** — changing provenance format across many facts requires scripting

### Spike Validation Results (2026-03-15)

Three spikes validated the architectural pillars. All tested via `vfa run --provider pi --profile mykb-spike`:

| Spike | Result | Key learning |
|-------|--------|-------------|
| 01 Context injection | PASS | Pi's `context` event injects `<mykb-context>` blocks, AI uses them to answer questions |
| 02 Tool gating | PASS | `tool_call` blocks .jsonl writes, AI reads the reason and switches to `kb_add` tool |
| 03 SQLite in Pi | PASS | `better-sqlite3` native module + FTS5 works in Pi container (Node.js 20) |

**Gotchas discovered:**
- Pi's `tool_call` event uses camelCase: `event.toolName` not `event.tool` — first attempt failed silently
- FTS5 is keyword-exact: searching "database" does not match "PostgreSQL" — BM25 is keyword-based, not semantic. Cross-area matching will need supplementary signals (area tags, fact tags) beyond raw FTS5

---

## Design Decisions

### 1. Brain Location

**Decision:** `~/.mykb/` by default. If `$MYKB_DIR` is set, use that instead.

Resolution chain:
1. `$MYKB_DIR` environment variable (explicit override)
2. `~/.mykb/` (default)

No walk-up-from-CWD. No per-project brains. One brain per machine, configurable via env var. This keeps it simple — knowledge is global, not project-scoped.

The brain directory is a git repository. `kb init` creates the directory structure and runs `git init`. JSONL and metadata files are git-tracked. `kb.db` is gitignored.

### 2. Area Definition Format

Each area is self-describing via a metadata file plus its JSONL data files. No central config needed for area definitions.

```
~/.mykb/
├── manifest.json               # area index (auto-generated, git-tracked)
├── areas/
│   ├── ci-pipelines/
│   │   ├── area.json           # area metadata
│   │   ├── facts.jsonl         # facts (append-only)
│   │   ├── decisions.jsonl     # decisions (append-only)
│   │   ├── gotchas.jsonl       # gotchas (append-only)
│   │   ├── patterns.jsonl      # patterns (append-only)
│   │   └── links.jsonl         # links (append-only)
│   ├── secrets-management/
│   │   ├── area.json
│   │   ├── facts.jsonl
│   │   └── ...
│   └── ...
├── kb.db                       # SQLite + FTS5 cache (gitignored)
└── .gitignore                  # ignores kb.db
```

**area.json** — area metadata:
```json
{
  "id": "ci-pipelines",
  "name": "CI/CD Pipelines",
  "summary": "Build runners, pipeline authoring, registry, artifact management",
  "owner": "jason",
  "tags": ["ci", "cd", "runners", "pipelines"],
  "created": "2026-03-15",
  "updated": "2026-03-15"
}
```

**manifest.json** — lightweight area index (auto-generated on every area create/update/delete and during `kb rebuild`):
```json
{
  "version": 1,
  "areas": [
    {"id": "ci-pipelines", "summary": "Build runners, pipeline authoring, registry", "owner": "jason", "updated": "2026-03-15"},
    {"id": "secrets-management", "summary": "Vault, secret engines, auth methods, policies", "owner": "jason", "updated": "2026-03-15"}
  ]
}
```

**Improvements over OSB v1:**
- Separate JSONL file per knowledge type (not everything in one markdown file)
- JSON metadata instead of YAML frontmatter in markdown (machine-readable, no parsing ambiguity)
- No bidirectional links to manage (OSB's `referenced-by` was fragile)
- Manifest is auto-generated from area.json files, single source of truth

### 3. JSONL Schema

All knowledge entries share a common envelope with type-specific fields.

**Common envelope:**
```json
{
  "id": "a1b2c3d4",
  "area": "ci-pipelines",
  "type": "fact|decision|gotcha|pattern|link",
  "text": "The knowledge content",
  "tags": ["tag1", "tag2"],
  "provenance": {
    "status": "verified|unverified|stale|expires",
    "date": "2026-03-15",
    "source": "cli-output",
    "detail": "optional extra context"
  },
  "zone": "active|established|archive",
  "created": "2026-03-15T10:30:00Z",
  "updated": "2026-03-15T10:30:00Z"
}
```

**ID generation:** Random nanoid (8 characters, alphanumeric). Stable across text changes — updating a fact's text produces a new JSONL line with the same ID and a later timestamp. The latest line for a given ID wins (append-only ordering).

Note: OSB v1 used content-addressable hashing (SHA-256 of text) for compaction references. mykb uses stable random IDs instead because content-addressable IDs break when text is updated — the hash changes, creating a new ID instead of a new version.

**`area` field:** Included in every JSONL entry so entries are self-contained and portable. Redundant with the directory path, but enables cross-area operations and future storage migrations without path dependency.

**Type-specific fields:**

**Fact** — no extra fields beyond the common envelope:
```json
{"id":"a1b2c3d4","area":"ci-pipelines","type":"fact","text":"CI runners use autoscaling VM pools with spot instances","tags":["runners","cloud"],"provenance":{"status":"verified","date":"2026-03-15","source":"cloud-console"},"zone":"active","created":"2026-03-15T10:30:00Z","updated":"2026-03-15T10:30:00Z"}
```

**Decision** — adds `why`, `rejected`, `context`:
```json
{"id":"b2c3d4e5","area":"ci-pipelines","type":"decision","text":"Use SQLite for query cache instead of PostgreSQL","tags":["storage"],"why":"No server dependency, embedded, rebuildable from JSONL","rejected":"PostgreSQL — requires running server, overkill for single-user","context":"Evaluated during storage format design","provenance":{"status":"verified","date":"2026-03-15","source":"design-review"},"zone":"active","created":"2026-03-15T10:30:00Z","updated":"2026-03-15T10:30:00Z"}
```

**Gotcha** — adds `failed` (boolean) and `resolution`:
```json
{"id":"c3d4e5f6","area":"ci-pipelines","type":"gotcha","text":"npm lockfile bakes in registry URL from ~/.npmrc at install time","tags":["npm","docker"],"failed":false,"resolution":null,"provenance":{"status":"verified","date":"2026-03-15","source":"debugging"},"zone":"active","created":"2026-03-15T10:30:00Z","updated":"2026-03-15T10:30:00Z"}
```

`resolution` values: `null` (unresolved), `"resolved"`, `"mitigated"`, `"wontfix"`. Improvement over OSB v1's `[failed]` text prefix — structured field instead of text convention.

**Pattern** — no extra fields:
```json
{"id":"d4e5f6g7","area":"ci-pipelines","type":"pattern","text":"Plan/apply workflow: separate read phase from write phase with serializable plan file","tags":["workflow"],"provenance":{"status":"verified","date":"2026-03-15","source":"project-retrospective"},"zone":"active","created":"2026-03-15T10:30:00Z","updated":"2026-03-15T10:30:00Z"}
```

**Link** — adds `url`:
```json
{"id":"e5f6g7h8","area":"ci-pipelines","type":"link","text":"Pipeline runner documentation","url":"https://docs.example.com/runners","tags":["runners","docs"],"provenance":{"status":"verified","date":"2026-03-15","source":"docs"},"zone":"active","created":"2026-03-15T10:30:00Z","updated":"2026-03-15T10:30:00Z"}
```

**Tombstone** — marks deletion:
```json
{"id":"a1b2c3d4","area":"ci-pipelines","deleted":true,"updated":"2026-03-15T10:30:00Z"}
```

### 4. SQLite Schema

Single database at `~/.mykb/kb.db`, gitignored, rebuilt from JSONL on startup.

SQLite stores **current state only** — no version history. Versions exist in the JSONL append-only log. During hydration, later lines overwrite earlier lines for the same ID (UPSERT semantics). Tombstones result in no row.

```sql
-- Main knowledge table (current state only, all types in one table)
CREATE TABLE entries (
  id          TEXT PRIMARY KEY,
  area        TEXT NOT NULL,
  type        TEXT NOT NULL CHECK(type IN ('fact','decision','gotcha','pattern','link')),
  text        TEXT NOT NULL,
  tags        TEXT,           -- JSON array as text: '["tag1","tag2"]'
  zone        TEXT NOT NULL DEFAULT 'active' CHECK(zone IN ('active','established','archive')),
  prov_status TEXT CHECK(prov_status IN ('verified','unverified','stale','expires')),
  prov_date   TEXT,           -- YYYY-MM-DD
  prov_source TEXT,
  prov_detail TEXT,
  -- Decision-specific
  why         TEXT,
  rejected    TEXT,
  context     TEXT,
  -- Gotcha-specific
  failed      INTEGER DEFAULT 0,
  resolution  TEXT CHECK(resolution IN (NULL,'resolved','mitigated','wontfix')),
  -- Link-specific
  url         TEXT,
  -- Timestamps
  created     TEXT NOT NULL,
  updated     TEXT NOT NULL
);

-- Indexes for common queries
CREATE INDEX idx_area ON entries(area);
CREATE INDEX idx_type ON entries(area, type);
CREATE INDEX idx_zone ON entries(area, zone);
CREATE INDEX idx_prov_status ON entries(prov_status);
CREATE INDEX idx_prov_date ON entries(prov_date);

-- Full-text search (standalone, not external content — rebuilt during hydration)
CREATE VIRTUAL TABLE entries_fts USING fts5(
  id,
  text,
  tags,
  area
);

-- Area metadata
CREATE TABLE areas (
  id      TEXT PRIMARY KEY,
  name    TEXT NOT NULL,
  summary TEXT,
  owner   TEXT,
  tags    TEXT,           -- JSON array
  created TEXT NOT NULL,
  updated TEXT NOT NULL
);
```

**Hydration process:**
1. On startup, check if `kb.db` exists
2. If not (or if `--rebuild` flag), drop and recreate all tables
3. For each area directory, read `area.json` → insert into `areas` table
4. For each `*.jsonl` file, read lines in order:
   - If tombstone (`deleted: true`): DELETE from `entries` where id matches
   - Otherwise: UPSERT into `entries` (INSERT OR REPLACE) — later lines overwrite earlier
5. After all entries loaded, populate `entries_fts` from `entries`
6. Hydration is fast (~500ms for 5000 entries)

**Key queries that need to be fast:**
- All facts for an area + zone: `SELECT * FROM entries WHERE area=? AND zone=?`
- Facts by tag: `SELECT * FROM entries WHERE tags LIKE '%"tag"%'`
- Full-text search: `SELECT e.* FROM entries_fts f JOIN entries e ON f.id = e.id WHERE f.text MATCH ?`
- Stale facts: `SELECT * FROM entries WHERE prov_status='verified' AND prov_date < date('now', '-30 days')`
- Area summaries: `SELECT * FROM areas`

### 5. KB CLI Commands

The `kb` CLI is focused on knowledge management only. No workspaces, journals, instances, containers.

#### Bootstrap
| Command | Purpose |
|---------|---------|
| `kb init` | Initialize a new brain at `$MYKB_DIR` or `~/.mykb/` |
| `kb init area <id> "<name>" "<summary>"` | Create a new area |

#### Writing
| Command | Purpose |
|---------|---------|
| `kb add fact <area> "<text>"` | Add a fact (flags: `--source`, `--tags`, `--zone`, `--unverified`) |
| `kb add decision <area> "<text>"` | Add a decision (flags: `--why`, `--rejected`, `--context`) |
| `kb add gotcha <area> "<text>"` | Add a gotcha (flags: `--failed`, `--source`) |
| `kb add pattern <area> "<text>"` | Add a pattern (flags: `--source`) |
| `kb add link <area> "<text>" "<url>"` | Add a link |

#### Reading
| Command | Purpose |
|---------|---------|
| `kb load <area>` | Load all current knowledge for an area (renders to markdown) |
| `kb load <area> --zone active` | Load only active zone |
| `kb load <area> --tag <tag>` | Load only facts matching a tag |
| `kb load <area> --json` | Output as JSON (for programmatic use) |
| `kb list` | List all areas with summaries |
| `kb list --json` | List areas as JSON |

#### Querying
| Command | Purpose |
|---------|---------|
| `kb search "<query>"` | Full-text search across all areas |
| `kb match "<text>"` | Find areas relevant to a text prompt |
| `kb stats` | Show knowledge statistics (counts by area, type, zone, provenance) |
| `kb stale` | List facts past freshness threshold |

#### Updating
| Command | Purpose |
|---------|---------|
| `kb update <area> <id> --text "<new text>"` | Update fact text (appends new JSONL line with same ID) |
| `kb update <area> <id> --tags "<t1>,<t2>"` | Update tags on an entry |
| `kb update <area> <id> --zone <zone>` | Move entry to a different zone |
| `kb update <area> <id> --source "<src>"` | Update provenance source |

#### Area Management
| Command | Purpose |
|---------|---------|
| `kb area update <id> --summary "<text>"` | Update area metadata |
| `kb area update <id> --owner "<name>"` | Update area owner |
| `kb area delete <id>` | Remove an area and all its knowledge |

#### Maintenance
| Command | Purpose |
|---------|---------|
| `kb verify <area> <id>` | Refresh verification date on a fact |
| `kb archive <area> <id>` | Move a fact to archive zone |
| `kb promote <area> <id>` | Move a fact from active to established |
| `kb delete <area> <id>` | Mark a fact as deleted (tombstone) |
| `kb compact [<area>]` | Rewrite JSONL, collapse versions, remove tombstones |
| `kb rebuild` | Rebuild SQLite cache from JSONL |

#### Persistence
| Command | Purpose |
|---------|---------|
| `kb save` | Commit all pending changes to git |
| `kb save --push` | Commit and push to remote |
| `kb save --message "<msg>"` | Commit with a custom message |

#### Export & Import
| Command | Purpose |
|---------|---------|
| `kb export agents-md` | Export area index as AGENTS.md format |
| `kb import osb <path>` | Import areas from an OSB v1 brain directory |

Note: `kb load <area>` serves as the render command — outputs markdown by default, JSON with `--json`. No separate `render` command needed.

**CLI write feedback:**
All write commands (`kb add`, `kb update`, `kb verify`, `kb promote`, `kb archive`, `kb delete`) return:
- The entry ID (created or modified)
- The area and type
- The current count of entries in that area

Example: `added fact a1b2c3d4 to ci-pipelines (23 facts, 4 decisions, 2 gotchas)`

This addresses an OSB v1 pain point where `add-fact: ok` gave no useful feedback.

**Improvements over OSB v1:**
- `kb promote` — explicit zone promotion (OSB had no API for this)
- `kb verify` — single command to refresh provenance (OSB required manual edits)
- `kb rebuild` — explicit cache rebuild (OSB regenerated on every save)
- No `install-hooks` command — Pi auto-discovers extensions
- Separate `add` subcommands per type instead of `add-fact`, `add-decision` etc.
- All `--rejected`, `--why`, `--context`, `--source` flags are optional (OSB v1 required `--rejected` on decisions)
- Write commands return created ID and entry counts (OSB v1 returned only "ok")

### 6. Context Injection Strategy

The Pi extension uses a **multi-signal relevance scoring** approach:

**Signals collected per turn:**

| Signal | Source | Weight | Example |
|--------|--------|--------|---------|
| File paths | `tool_call` (read/edit/write) | High | Reading `terraform/modules/vm/` → score `cloud-infra` area |
| Command patterns | `tool_call` (bash) | High | Running `ansible-playbook` → score `config-mgmt` area |
| User prompt | `input` event | Medium | "fix the vault policy" → score `secrets-management` area |
| Conversation keywords | `context` event | Medium | Recent messages mention "DNS" → score `networking` area |
| Previously loaded areas | Session state | Low (boost) | Already loaded `ci-pipelines` → slight boost for related areas |

**Scoring algorithm:**
1. On each turn, collect signals from the current tool call / user input
2. For each area, compute relevance score by matching signals against:
   - Area summary keywords
   - Area tags
   - Fact text in the area (via FTS5 query)
3. Areas scoring above threshold get their facts injected
4. Previously injected areas remain in context (sticky) unless displaced

**Token budget:**
- Tier 1 (area index): ~500-1000 tokens, always present
- Tier 2 (auto-injected facts): budget of ~2000 tokens per turn
- If multiple areas score above threshold, prioritize by score, truncate to budget
- Facts within an area prioritized: active zone first, then by recency

**Injection format:**
```markdown
<mykb-context>
## ci-pipelines
- CI runners use autoscaling VM pools with spot instances #runners (verified:2026-03-15)
- Pipeline timeout set to 30 minutes for build jobs #timeout (verified:2026-03-10)

## secrets-management
- Vault uses auto-unseal with Azure Key Vault #azure (verified:2026-03-12)
</mykb-context>
```

Wrapped in custom XML tags so it's identifiable in the message stream. Injected via Pi's `context` event as a system message prepended to the message array.

### 7. Cross-Area Matching Algorithm

**Approach: FTS5-powered keyword matching** — simple, fast, no external dependencies.

```
kb match "working on terraform for customer acme"
```

1. Tokenize the input text
2. Run FTS5 `MATCH` query against area summaries and fact text
3. Score results by BM25 (built into FTS5)
4. Group by area, sum scores
5. Return areas sorted by total relevance score

**Why not embeddings:** Adds vector database dependency, latency, and complexity. FTS5 BM25 scoring covers 95% of use cases (same conclusion as Engram). Can be upgraded to embeddings in the future if needed — the interface stays the same.

**Performance:** FTS5 queries complete in <5ms for 10k entries. Well within the latency budget for per-turn injection.

### 8. Background Observer Design

**Phase:** This is a Phase 2 feature. Not required for initial release.

**Proposed design:**

The background observer is a Pi extension event handler that watches tool results and turn completions, accumulates context, and periodically makes a lightweight LLM call to decide what to capture.

```
Primary agent works normally
  ↓
tool_result / turn_end events fire
  ↓
Observer extension collects:
  - Files read/written (paths)
  - Bash commands and output (summarized)
  - Error → success transitions
  - New information mentioned in AI responses
  ↓
Every N turns (configurable, default 5):
  Observer calls a cheap/fast LLM with:
    - Collected context summary
    - Current area facts (what we already know)
    - Prompt: "What new knowledge was discovered? Return structured facts."
  ↓
If new facts returned:
  - Write via core library (same in-process path as registered tools)
  - Log to session for transparency
```

**Model choice:** Use the cheapest available model (Haiku-class or Gemini Flash). The observer prompt is small and structured — doesn't need frontier reasoning.

**Cost estimation:** At ~5 calls per session, ~1000 tokens per call, ~$0.001 per session. Negligible.

**Conflict avoidance:** Observer writes to JSONL (append-only) — no conflicts possible. SQLite rebuild happens on next `kb` command.

**Configuration:**
```json
{
  "observer": {
    "enabled": true,
    "frequency": 5,
    "model": "haiku",
    "auto_areas": true
  }
}
```

### 9. Language Choice

**Decision: TypeScript** for both the CLI and the Pi extension.

Rationale:
- **Single language** — extension and CLI share types, utilities, and the SQLite interface
- **Pi-native** — the extension is TypeScript, having the CLI in the same language avoids a binary distribution problem
- **better-sqlite3** — synchronous, fast, well-maintained SQLite binding for Node.js. Works with FTS5 out of the box
- **No binary distribution** — a TypeScript CLI runs via `npx` or as part of the Pi package. No need to cross-compile Go binaries for every platform
- **Simpler packaging** — one npm package contains both the extension and the CLI

The OSB v1 Go code is a reference for the knowledge model and algorithms, but we don't need to reuse it directly.

**CLI entry point:** `npx mykb <command>` or `kb <command>` (via npm bin link).

### 10. Pi Extension Packaging

**Distribution:** Pi Package via npm, installable with `pi install npm:@vilosource/mykb`.

**package.json:**
```json
{
  "name": "@vilosource/mykb",
  "version": "0.1.0",
  "description": "Knowledge management for AI coding agents",
  "keywords": ["pi-package"],
  "type": "module",
  "bin": {
    "kb": "./dist/cli.js"
  },
  "pi": {
    "extensions": ["./dist/extension"]
  },
  "peerDependencies": {
    "@mariozechner/pi-ai": "*",
    "@mariozechner/pi-agent-core": "*",
    "@mariozechner/pi-coding-agent": "*",
    "@sinclair/typebox": "*"
  },
  "dependencies": {
    "better-sqlite3": "^11.0.0"
  }
}
```

**Directory structure:**
```
mykb/
├── package.json
├── src/
│   ├── extension/
│   │   ├── index.ts            # Pi extension entry point
│   │   ├── hooks/
│   │   │   ├── session.ts      # session_start, session_shutdown
│   │   │   ├── context.ts      # context event (Tier 2 injection)
│   │   │   ├── input.ts        # input event (area matching)
│   │   │   ├── tool-call.ts    # tool_call event (gating + area detection)
│   │   │   └── tool-result.ts  # tool_result event (passive observation)
│   │   ├── state.ts            # in-memory session state
│   │   └── scorer.ts           # relevance scoring for context injection
│   ├── cli/
│   │   ├── cli.ts              # CLI entry point (kb command)
│   │   ├── commands/           # one file per command group
│   │   └── render.ts           # markdown output renderer
│   ├── core/
│   │   ├── store.ts            # JSONL read/write
│   │   ├── db.ts               # SQLite + FTS5 interface
│   │   ├── hydrate.ts          # JSONL → SQLite hydration
│   │   ├── types.ts            # shared type definitions
│   │   └── config.ts           # brain location, settings
│   └── tools/                  # Pi-registered tools (kb_add, kb_search, etc.)
├── dist/                       # compiled output
├── tests/
└── tsconfig.json
```

**Installation methods:**
- `pi install npm:@vilosource/mykb` — from npm registry
- `pi install git:github.com/vilosource/mykb` — from GitHub
- Manual: clone to `~/.pi/agent/extensions/mykb/` and run `npm install`

**Registered tools** (available to the AI as native tools):

| Tool | Purpose |
|------|---------|
| `kb_add` | Add a fact/decision/gotcha/pattern/link to an area |
| `kb_search` | Full-text search across all areas |
| `kb_load` | Load all knowledge for an area |
| `kb_list` | List all areas with summaries |
| `kb_verify` | Refresh verification on a fact |

These replace the subprocess `osb add-fact`, `osb search`, etc. calls. The AI uses them like any other tool — no bash command syntax to remember.

**Tool output format:** Registered tools return **compact markdown** (same format as Tier 2 context injection). This is the most token-efficient format the AI can consume. The CLI `--json` flag is for programmatic/scripting use, not for AI consumption.

**Registered commands** (via `pi.registerCommand()`):

| Command | Purpose |
|---------|---------|
| `/kb [area...]` | Load one or more areas into context (Tier 3) |
| `/kb` (no args) | Show what's currently loaded |
| `/kb --all` | List all available areas |

Note: `/kb` is a registered command, not a SKILL.md. Commands are handled by TypeScript code in the extension, not by the AI reading a markdown file. This ensures reliable invocation — no risk of the AI ignoring a skill description.

### 11. Write Strategy: Dual-Write

Every write operation does two things atomically:
1. **Append to JSONL** (the source of truth, git-tracked)
2. **UPSERT into SQLite** (the query cache)

This means reads are always consistent — there's no window where JSONL has data that SQLite doesn't. The full rebuild from JSONL (`kb rebuild`) is only needed when:
- `kb.db` doesn't exist (first run, fresh clone of brain repo)
- `kb.db` is corrupted
- JSONL was modified externally (e.g., `git pull` brought changes from another machine)

**Stale cache detection:** On startup (CLI invocation or Pi extension `session_start`), compare the max mtime of all tracked files (JSONL + area.json + manifest.json) against a `last_hydrated` timestamp stored in SQLite. If any file is newer, trigger a full rebuild. This handles the `git pull` case automatically — any externally modified file triggers re-sync. If SQLite is current, skip hydration entirely (fast startup).

**Dirty shutdown recovery:** On `session_start`, check if there are uncommitted JSONL changes in the brain git repo (modified files not yet committed). If found, this indicates a previous session died without running `kb save` (container killed, OOM, crash). The extension auto-commits these with a recovery message: `kb: recovery commit — uncommitted changes from previous session`. This is the "fsck on boot" pattern — detect dirty state and fix it before proceeding.

**Accepted limitation:** If the container is killed (SIGKILL, OOM, docker kill), the `session_shutdown` handler never fires and `kb save` doesn't run. JSONL writes are safe (already on disk via dual-write), but the git commit doesn't happen. Data is NOT lost — it's in the JSONL files — but it's uncommitted until the next session's dirty shutdown recovery picks it up.

**SQLite WAL mode:** Enabled at database creation. WAL (Write-Ahead Logging) allows concurrent reads from CLI and extension without locking. Multiple readers, single writer.

### 12. Git Commit Strategy

Writes to JSONL happen immediately (so they're queryable). Git commits are **batched and explicit**.

| Command | Purpose |
|---------|---------|
| `kb save` | Commit all pending JSONL/metadata changes to git with an auto-generated summary message |
| `kb save --push` | Commit and push to remote |
| `kb save --message "<msg>"` | Commit with a custom message |

**Automatic save on session end:** The Pi extension's `session_shutdown` handler calls `kb save` automatically. This ensures no knowledge is left uncommitted between sessions.

**What gets committed:** All modified files in the brain directory — JSONL files, area.json files, manifest.json. `kb.db` is gitignored and never committed.

**Commit message format:**
```
kb: add 3 facts, 1 decision to ci-pipelines; verify 2 facts in networking
```
Auto-generated from a diff of JSONL changes since last commit.

This mirrors OSB v1's explicit `osb save` model, with the improvement that writes are immediately queryable even before committing. The Pi extension adds automatic session-end saves so knowledge is never lost.

### 13. Extension and CLI Shared Core

The Pi extension and the `kb` CLI are both thin wrappers around a shared core library. Neither calls the other as a subprocess.

```
src/core/                ← shared library
  store.ts                  JSONL read/write + SQLite UPSERT
  db.ts                     SQLite + FTS5 queries
  hydrate.ts                JSONL → SQLite full rebuild
  types.ts                  shared type definitions
  config.ts                 brain location resolution
      ↑                          ↑
src/cli/cli.ts           src/extension/index.ts
  (thin wrapper)           (thin wrapper)
  parses args →              registers tools/hooks →
  calls core                 calls core
      ↑                          ↑
`kb` binary              Pi extension
(user terminal)          (in-process, same Node.js)
```

**Why not subprocess:** The extension runs in Pi's Node.js process. Calling the CLI as a subprocess would mean spawning a new process, re-resolving the brain path, re-opening SQLite, and re-parsing args on every tool call. In-process calls to the core library are instant.

**Concurrency:** The CLI and extension may access the same `kb.db` simultaneously (user runs `kb list` in a terminal while Pi is also querying). SQLite WAL mode handles this — multiple concurrent readers, writes are serialized.

### 14. First-Run Experience

**If the brain doesn't exist:**

| Context | Behavior |
|---------|----------|
| `kb init` CLI | Creates `~/.mykb/`, initializes git repo, creates `.gitignore`, creates empty `manifest.json` |
| `kb add` CLI (no brain) | Error: "Brain not found. Run `kb init` first." |
| Pi extension `session_start` (no brain) | Auto-initialize: create brain directory, log a notification via `ctx.ui.notify("mykb: initialized brain at ~/.mykb/")` |
| Pi registered tool `kb_add` (no brain) | Auto-initialize, then proceed with the add |

**If an area doesn't exist:**

When `kb add fact <area> "text"` is called and the area doesn't exist, **auto-create it** with:
- `id` = the provided area name
- `name` = area name with hyphens replaced by spaces, title-cased
- `summary` = empty (user can update later via `kb area update <id> --summary "..."`)
- `owner` = empty

This is zero-friction — the user starts adding facts and areas materialize. No separate `kb init area` step required (though it's still available for explicit creation with metadata).

### 15. OSB v1 Migration

A separate `kb import` command converts an existing OSB brain to mykb format.

```
kb import osb ~/.osb/main/brain/
```

**Process:**
1. Scan `areas/` directory for BRAIN.md files
2. Parse each BRAIN.md: extract frontmatter, active/established facts, decisions, gotchas, patterns, links
3. Convert each knowledge entry to JSONL format with:
   - ID: nanoid (new, since OSB content-hashes aren't compatible)
   - Provenance: preserved from OSB's `(verified:YYYY-MM-DD — source)` annotations
   - Zone: mapped from OSB's `### Active` / `### Established` sections
   - Tags: preserved from inline `#tag` syntax
4. Write to `~/.mykb/areas/<id>/` with appropriate JSONL files
5. Create `area.json` from OSB frontmatter (summary, owner, dates)
6. Regenerate `manifest.json`
7. Rebuild SQLite cache

**Scope:** Areas only. Workspaces, journals, and container-specific data are not migrated — they belong to `osb`, not `kb`.

**Not a core feature:** This is a one-time migration utility. It can be a separate script or a CLI subcommand, but it's not part of the extension or the core library.
