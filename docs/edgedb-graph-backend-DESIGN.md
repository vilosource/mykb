# EdgeDB Graph Backend — Design Document

**Date:** 2026-03-18
**Status:** Ideation
**Scope:** mykb v2 — graph-relational storage backend

---

## 1. Motivation

### What we have today

mykb v1 uses a JSONL + SQLite hybrid:
- **JSONL files** per area/type — git-tracked, append-only, source of truth
- **SQLite FTS5** — gitignored cache, rebuilt from JSONL, keyword search
- **Interfaces** — `KnowledgeStore` and `WorkspaceStorage` abstract the storage

This works well for basic CRUD and keyword search. But the data has natural
relationships that the flat storage model cannot express or query.

### What's missing

**Relationships between entries are invisible.** Today, when an entry in
`stark-picking` references `area:infra-vm` or `decision:VM-PROV-001`, that's
just text — not a traversable link. The system has no way to:

- Find everything connected to a concept across all areas
- Traverse dependency chains (decision A led to decision B)
- Discover implicit clusters (entries sharing tags across areas)
- Answer "what areas are affected if I change X?"
- Show how workspaces, areas, entries, and tags form a knowledge graph

**Cross-area queries are weak.** `kb search` does keyword matching across
all areas. But "show me everything related to Vault Agent SSL" requires
understanding relationships, not just matching the string "vault".

**Tags are flat.** Tags exist on entries but aren't queryable as a connected
structure. You can't ask "what tags co-occur?" or "what's the tag cloud for
this workspace?"

---

## 2. Why EdgeDB

EdgeDB is a graph-relational database built on PostgreSQL. It combines the
schema rigor of a relational DB with first-class relationship modeling.

### Why not other options

| Option | Verdict | Reasoning |
|--------|---------|-----------|
| **Neo4j** | Too heavy | Java-based, requires JVM, overkill for personal KB |
| **SurrealDB** | Promising but young | Less mature ecosystem, uncertain stability |
| **SQLite + recursive CTEs** | Already have it | Not a real graph — relationship queries get ugly fast |
| **Plain GraphQL over JSONL** | Incomplete | Structured queries but no relationship storage |
| **EdgeDB** | Best fit | Graph-relational, PostgreSQL-backed, built-in GraphQL, TypeScript-native client, embeddable |

### EdgeDB strengths for mykb

1. **Schema DSL** — EdgeDB's schema language maps naturally to mykb's domain
2. **Links are first-class** — relationships aren't join tables, they're part of the schema
3. **Built-in GraphQL** — free query API without building one
4. **TypeScript client** — native `@edgedb/client` with type generation
5. **Migrations** — schema changes are tracked and applied automatically
6. **Computable properties** — derived fields in the schema (e.g., entry age, staleness)
7. **PostgreSQL-backed** — battle-tested storage engine underneath

---

## 3. Data Model — From Flat to Graph

### Current model (v1 — flat)

```
areas/
  stark-picking/
    facts.jsonl       ← flat list of entries
    decisions.jsonl   ← no relationships between entries
    gotchas.jsonl
    patterns.jsonl
    links.jsonl
  infra-vm/
    facts.jsonl       ← no connection to stark-picking
```

Entries reference other entries/areas only as text strings. The system
cannot traverse these references.

### Proposed model (v2 — graph)

```
                    ┌──────────┐
                    │ Workspace│
                    │  stark   │
                    └────┬─────┘
                         │ has_area
                    ┌────▼─────┐
        ┌──────────│   Area    │──────────┐
        │          │stark-pick │          │
        │          └────┬─────┘          │
        │               │ contains       │ links_to
        │          ┌────▼─────┐     ┌────▼─────┐
        │          │  Entry   │     │   Area   │
        │          │STARK-002 │     │ infra-vm │
        │          └──┬───┬───┘     └──────────┘
        │             │   │
        │    tagged ──┘   └── references
        │        │              │
        │   ┌────▼─────┐  ┌────▼──────┐
        │   │   Tag    │  │  Entry    │
        │   │  vault   │  │VM-PROV-001│
        │   └──────────┘  └───────────┘
        │
        │ has_jira
   ┌────▼─────┐
   │  JiraRef │
   │STARK-653 │
   └──────────┘
```

### EdgeDB schema

```esdl
module default {

  # --- Core knowledge types ---

  abstract type Timestamped {
    required created: datetime {
      default := datetime_current();
    };
    required updated: datetime {
      default := datetime_current();
    };
  }

  scalar type EntryType extending enum<fact, decision, gotcha, pattern, link>;
  scalar type ZoneType extending enum<active, established, archive>;
  scalar type ProvenanceStatus extending enum<verified, unverified, stale, expires>;
  scalar type ResolutionStatus extending enum<resolved, mitigated, wontfix>;

  type Area extending Timestamped {
    required id: str {
      constraint exclusive;
    };
    required name: str;
    summary: str;
    owner: str;
    multi tags: Tag;

    # Relationships
    multi entries := .<area[is Entry];
    multi linked_areas: Area;
    multi workspaces := .<areas[is Workspace];
  }

  type Entry extending Timestamped {
    required entry_id: str {
      constraint exclusive;
    };
    required area: Area;
    required type: EntryType;
    required text: str;
    required zone: ZoneType {
      default := ZoneType.active;
    };

    # Provenance
    prov_status: ProvenanceStatus {
      default := ProvenanceStatus.unverified;
    };
    prov_date: datetime;
    prov_source: str;

    # Type-specific fields
    why: str;                    # decision
    rejected: str;               # decision
    context: str;                # decision
    failed: bool;                # gotcha
    resolution: ResolutionStatus; # gotcha
    url: str;                    # link

    # Relationships — the key new capability
    multi tags: Tag;
    multi references: Entry;      # this entry references other entries
    multi referenced_by := .<references[is Entry];
    multi supersedes: Entry;      # this entry replaces older ones
    multi superseded_by := .<supersedes[is Entry];
  }

  type Tag {
    required name: str {
      constraint exclusive;
    };
    multi entries := .<tags[is Entry];
    multi areas := .<tags[is Area];
  }

  # --- Workspace types ---

  type Workspace extending Timestamped {
    required ws_id: str {
      constraint exclusive;
    };
    required name: str;

    # State
    phase: str;
    active_task: str;
    blocked: str;
    next_task: str;

    # Relationships
    multi areas: Area;
    multi journal: JournalEntry {
      on target delete allow;
    };

    # External links
    jira: str;
    wiki: str;
    multi repos: str;
  }

  type JournalEntry extending Timestamped {
    required date: cal::local_date;
    required text: str;
  }
}
```

### Relationship types

| Relationship | From | To | Meaning |
|-------------|------|-----|---------|
| `area.linked_areas` | Area | Area | Cross-area reference (e.g., stark-picking → infra-vm) |
| `entry.references` | Entry | Entry | Entry cites another entry (e.g., STARK-002 → VM-PROV-001) |
| `entry.supersedes` | Entry | Entry | Entry replaces an older one (archive chain) |
| `entry.tags` | Entry | Tag | Entry is tagged (many-to-many) |
| `area.tags` | Area | Tag | Area-level tags |
| `workspace.areas` | Workspace | Area | Workspace contains areas |
| `entry.area` | Entry | Area | Entry belongs to area |

---

## 4. Queries That Become Possible

### "Show me everything connected to Vault"

```edgeql
select Tag {
  name,
  entries: {
    entry_id, text, type,
    area: { id, name },
    references: { entry_id, text },
  }
} filter .name = 'vault';
```

### "What areas are affected if I change the VPN setup?"

```edgeql
select Area {
  id, name,
  entries: {
    entry_id, text,
    references: { entry_id, text, area: { id } },
  } filter .tags.name = 'vpn' or .tags.name = 'networking'
} filter count(.entries) > 0;
```

### "What decisions led to the current Stark architecture?"

```edgeql
select Entry {
  entry_id, text, why, rejected,
  references: {
    entry_id, text, type,
    area: { id },
  },
  referenced_by: {
    entry_id, text, type,
    area: { id },
  },
} filter .area.id = 'stark-picking'
  and .type = EntryType.decision
  and .zone = ZoneType.active;
```

### "What tags co-occur with 'ssl'?"

```edgeql
select Tag {
  name,
  co_occurrence := count(.entries filter .tags.name = 'ssl'),
} filter .name != 'ssl' and .co_occurrence > 0
  order by .co_occurrence desc;
```

### "Traverse from entry X, depth 2"

```edgeql
select Entry {
  entry_id, text, area: { id },
  references: {
    entry_id, text, area: { id },
    references: {
      entry_id, text, area: { id },
    }
  }
} filter .entry_id = 'abc123';
```

### GraphQL equivalent (auto-generated by EdgeDB)

```graphql
query {
  Tag(filter: { name: { eq: "vault" } }) {
    name
    entries {
      entry_id
      text
      type
      area { id name }
      references { entry_id text }
    }
  }
}
```

---

## 5. Architecture — Parallel Operation

The v1 JSONL+SQLite backend and v2 EdgeDB backend can run in parallel.
This enables a safe migration path.

```
kb add fact stark-picking "..."
       │
  KnowledgeStore (interface)
       │
       ├──> JsonlSqliteStore (v1)  ← git-tracked source of truth
       │      writes JSONL + SQLite
       │
       └──> EdgeDbStore (v2)       ← graph query engine
              writes EdgeDB
              extracts relationships from text
```

### Write path

Both backends implement `KnowledgeStore`. Writes go to both:
- JsonlSqliteStore: appends to JSONL, updates SQLite
- EdgeDbStore: inserts entry, creates/links Tag nodes, parses text for
  cross-references and creates `references` edges

### Read path

Reads are routed based on query type:
- **Flat queries** (`kb load`, `kb search`): either backend (same result)
- **Graph queries** (`kb traverse`, `kb related`, `kb graph`): EdgeDB only

### New CLI commands (graph-only)

```bash
kb traverse <entry-id> [--depth N]    # follow relationships from an entry
kb related <area> [--depth N]         # find related areas via entry references
kb graph [area]                       # visualize the knowledge graph
kb tags [--co-occur <tag>]            # tag analysis and co-occurrence
kb impact <area|entry>                # what's affected if this changes?
```

### Interface extension

```typescript
// New interface for graph-specific operations
export interface GraphStore {
  // Relationship management
  relate(fromId: string, toId: string, type: RelationType): void;
  unrelate(fromId: string, toId: string, type: RelationType): void;

  // Graph queries
  traverse(id: string, depth?: number): GraphNode[];
  related(area: string, depth?: number): RelatedArea[];
  impact(id: string): ImpactResult;
  tagCoOccurrence(tag: string): TagCoOccurrence[];

  // GraphQL pass-through
  graphql(query: string, variables?: Record<string, unknown>): unknown;
}

export type RelationType = 'references' | 'supersedes' | 'linked_areas';

export type GraphNode = {
  entry: KnowledgeEntry;
  edges: { type: RelationType; target: GraphNode }[];
};
```

---

## 6. Relationship Extraction

### Implicit relationships in existing data

The current JSONL entries already contain implicit relationships as text:

| Pattern | Example | Extracted relationship |
|---------|---------|----------------------|
| `area:<id>` | "See area:infra-vm" | `entry.area` → `linked_areas` → `Area(infra-vm)` |
| `<ID>` pattern | "See VM-PROV-001" | `entry` → `references` → `Entry(VM-PROV-001)` |
| `workspace:<id>` | "See workspace:vm-provisioning" | `entry` → workspace link |
| `#tag` in text | "Fixed #ssl #vault" | `entry` → `tags` → `Tag(ssl)`, `Tag(vault)` |
| Decision `rejected` field | "Rejected: Ansible Vault" | Captures alternative not taken |
| Gotcha `resolution` field | Points to fix | Could link to the fixing entry |

### Migration strategy

1. Import all JSONL entries into EdgeDB (bulk load)
2. Run relationship extractor over all entries:
   - Parse `area:X` references → create `linked_areas` edges
   - Parse `UPPERCASE-NNN` patterns → create `references` edges between entries
   - Parse `#tag` strings → create `Tag` nodes and edges
   - Parse `See workspace:X` → link entries to workspaces
3. Create `supersedes` edges from JSONL update history (same ID, newer timestamp)
4. Validate: entry count matches, all tags extracted, spot-check relationships

### Ongoing relationship extraction

New entries are analyzed at write time:
- Text is parsed for relationship patterns
- Tags are extracted and linked
- The `EdgeDbStore.addFact()` implementation handles this transparently

---

## 7. JSONL as Source of Truth

Even with EdgeDB, JSONL files remain the canonical source:

```
JSONL files (git-tracked)
    │
    ├──> SQLite FTS5 (rebuildable cache)     ← current
    └──> EdgeDB (rebuildable graph store)    ← new
```

**Why keep JSONL:**
- Git history provides full audit trail
- Human-reviewable diffs
- Portable — works without any database server
- Disaster recovery — `kb rebuild` regenerates both SQLite and EdgeDB
- CI/CD friendly — JSONL files can be validated in pipelines

**EdgeDB is a derived store**, like SQLite today. It can be rebuilt from
JSONL at any time via `kb rebuild --edgedb`.

---

## 8. Deployment Options

### Option A: EdgeDB Cloud (simplest)

- Managed EdgeDB instance
- Zero ops, automatic backups
- Cost: free tier available for small DBs

### Option B: Local EdgeDB (self-hosted)

- `edgedb server install` on the workstation
- Data in `~/.edgedb/`
- No network dependency

### Option C: Docker container

- `docker run -d edgedb/edgedb`
- Consistent across environments
- Can run alongside the mykb brain

**Recommendation:** Start with Option B (local) for development. Option C
for production/Pi containers where Docker is already present.

---

## 9. Implementation Phases

### Phase 1: Schema and migration tool

- Define EdgeDB schema (section 3)
- Build `kb rebuild --edgedb` to import JSONL → EdgeDB
- Build relationship extractor (section 6)
- Validate: all entries imported, relationships extracted

### Phase 2: Dual-write

- Implement `EdgeDbStore` conforming to `KnowledgeStore` interface
- Wire dual-write: every `kb add/update/delete` writes to both backends
- Validate: JSONL and EdgeDB stay in sync

### Phase 3: Graph queries

- Implement `GraphStore` interface
- Add new CLI commands: `kb traverse`, `kb related`, `kb tags`, `kb impact`
- Build GraphQL endpoint for programmatic access

### Phase 4: Context delivery

- Enhance Pi context injection with graph-aware retrieval
- "Load this area AND its directly connected areas"
- Tag-based context expansion (find related entries via tag graph)

### Phase 5: Evaluate and decide

- Is EdgeDB pulling its weight? Are graph queries actually used?
- Decide: keep dual-write, or migrate primary store to EdgeDB
- If migrating: JSONL becomes export format, EdgeDB becomes source of truth

---

## 10. Open Questions

1. **EdgeDB in containers** — Can Pi coding agent containers run EdgeDB?
   Or does it need to be a sidecar/external service?

2. **Relationship extraction accuracy** — How reliable is pattern matching
   for `UPPERCASE-NNN` entry IDs? False positives in entry text?

3. **Schema evolution** — How do we handle adding new relationship types
   over time? EdgeDB migrations should handle this.

4. **Performance** — Is EdgeDB query performance acceptable for CLI response
   times? Benchmark needed for large graphs (1000+ entries, 5000+ edges).

5. **GraphQL vs EdgeQL** — Do we expose GraphQL externally (for other
   tools/agents) or keep it internal? EdgeQL is more powerful but less
   portable.

6. **Offline operation** — JSONL works offline. EdgeDB requires a running
   server. Is this acceptable? Fallback to JSONL-only mode?

---

## 11. References

- [EdgeDB Documentation](https://www.edgedb.com/docs)
- [EdgeDB TypeScript Client](https://www.edgedb.com/docs/clients/js/index)
- [EdgeDB Built-in GraphQL](https://www.edgedb.com/docs/graphql/index)
- [EdgeDB Schema Language](https://www.edgedb.com/docs/datamodel/index)
- [mykb storage-format-RESEARCH.md](./storage-format-RESEARCH.md) — original storage decision
- [mykb types.ts](../src/core/types.ts) — current KnowledgeStore and WorkspaceStorage interfaces
- [Mem0 Graph Memory](https://mem0.ai/blog/graph-memory-solutions-ai-agents) — graph memory for AI agents
