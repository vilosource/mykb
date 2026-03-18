# Graph Backend — Design Document

**Date:** 2026-03-18
**Status:** Draft — Iteration 2
**Prerequisite:** [graph-backend-MOTIVATION.md](./graph-backend-MOTIVATION.md)

---

## Design Decisions To Resolve

These are the hard architectural questions identified during review. Each
must have a clear answer before implementation begins.

### DD-1: Source of truth

**Question:** Does JSONL remain the source of truth, or does Gel become it?

**The tension:** Explicit relationships (`kb relate A B`) have no natural
JSONL representation. If JSONL is source of truth, `kb rebuild` loses
relationships. If Gel is source of truth, we lose git-tracked diffs and
offline operation.

**Research findings:**

1. **EdgeDB is now Gel** (renamed Feb 2025, same tool). No embedded mode —
   requires a running server process. Not suitable as the sole store for a
   portable, offline-capable tool.

2. **Graphiti (Zep)** uses event sourcing for knowledge graphs: append-only
   episode log → materialized graph. Episodes are source of truth. Graph
   is a derived projection that can be rebuilt. Closest architectural match
   to mykb's JSONL + derived index pattern.

3. **Obsidian/Logseq** keep files as source of truth. Graph is computed at
   runtime from `[[wiki-links]]`. Never persisted separately.

4. **N-Triples** (RDF): one triple per line (`<subject> <predicate> <object>`),
   git-friendly, line-oriented. Proves that graph relationships CAN be
   stored in a flat, append-only, diffable format.

5. **No system has fully solved portable + graph + git + offline.** The
   closest pattern: flat files as source of truth, graph materialized on
   demand into an optional query engine.

**The key insight:** The original tension ("relationships can't live in
JSONL") is false. Relationships CAN be stored in JSONL — either inline
on entries or in a dedicated relationships file. The graph DB is then a
materialized view, not a source of truth. This is the same pattern mykb
already uses with SQLite.

**Options (revised):**

| Option | Pros | Cons |
|--------|------|------|
| ~~A: JSONL only~~ | ~~Relationships lost on rebuild~~ | ~~Rejected — original framing was wrong~~ |
| ~~B: Gel becomes source of truth~~ | ~~Single store~~ | ~~Rejected — Gel requires server, no offline, no git~~ |
| **E: JSONL with relationships + Gel as materialized view** | Git-friendly, offline, portable. Gel adds graph queries when available. No data loss on rebuild. | Relationships file is global (cross-area). Gel is optional infrastructure. |

**Decision: Option E.**

JSONL remains the sole source of truth. Relationships are stored in JSONL.
Gel materializes a graph index for fast traversal queries, exactly like
SQLite materializes a text index for fast search queries. Both are
rebuildable from JSONL. Both are optional.

```
JSONL files (source of truth, git-tracked)
  ├──> entries: areas/<id>/facts.jsonl, decisions.jsonl, ...
  ├──> relationships: relationships.jsonl (global, cross-area)
  │
  ├──> SQLite FTS5 (derived, rebuildable) → kb search
  └──> Gel (derived, rebuildable, optional) → kb traverse, kb related
```

**Relationship storage in JSONL:**

A global `~/.mykb/relationships.jsonl` file. Each line is one relationship:

```jsonl
{"id":"r001","from":"f001","from_area":"stark-picking","to":"d003","to_area":"infra-vm","type":"references","source":"explicit","confidence":1.0,"created":"2026-03-18","updated":"2026-03-18"}
{"id":"r002","from":"area:stark-picking","to":"area:infra-vm","type":"linked_areas","source":"extracted","confidence":0.9,"created":"2026-03-18","updated":"2026-03-18"}
```

Why global, not per-area:
- Relationships are cross-area by nature (area A → area B)
- Per-area files would duplicate cross-area relationships or arbitrarily
  assign them to one side
- One file is simpler, diffs cleanly, compacts easily

Why this works:
- Append-only (same as entry JSONL)
- Git-friendly (one line per relationship, clean diffs)
- `kb compact --relationships` removes superseded/deleted relationships
- `kb rebuild` reads entries JSONL + relationships JSONL → rebuilds
  both SQLite and Gel

**Status:** Resolved.

---

### DD-1a: Gel vs alternatives for the graph materialized view

**Question:** Now that Gel is just a materialized view (not source of
truth), is it still the right choice? Or is something lighter sufficient?

**Options:**

| Option | Query language | Server required | Offline | Fit |
|--------|---------------|-----------------|---------|-----|
| **Gel (EdgeDB)** | EdgeQL + GraphQL | Yes (PostgreSQL) | No | Powerful but heavy for a derived index |
| **SQLite + relationship tables** | SQL + recursive CTEs | No (embedded) | Yes | Already have SQLite. Relationship queries are ugly but work. |
| **FalkorDBLite** | Cypher | No (embedded) | Yes | Young project, but embedded graph with real query language |
| **In-memory graph (custom)** | TypeScript API | No | Yes | Built on startup from JSONL, no persistence needed |

Since Gel is now optional infrastructure (not source of truth), the bar
is different. The question is: do graph queries justify running a
PostgreSQL server?

For a personal knowledge base with ~1000 entries and ~5000 relationships:
- SQLite with a `relationships` table and recursive CTEs may be sufficient
- An in-memory graph built on `kb rebuild` from JSONL is another option
- Gel becomes relevant if/when the graph grows or external tools need
  the GraphQL API

**Decision:** Deferred. Start with SQLite relationship tables (zero new
infrastructure). Add Gel later if graph query complexity justifies it.
The architecture supports both because the source of truth is JSONL
regardless.

**Status:** Resolved (start with SQLite, Gel is a future upgrade).

---

### DD-2: Entry type modeling

**Question:** Single `Entry` type with nullable fields, or polymorphic subtypes?

**Decision:** Polymorphic subtypes. EdgeDB's type system supports this
natively. A single wide Entry with `why: str | null` on every fact is the
wrong model for a graph-relational DB.

```esdl
abstract type Entry extending Timestamped {
  required entry_id: str { constraint exclusive; };
  required area: Area;
  required text: str;
  required zone: ZoneType { default := ZoneType.active; };
  prov_status: ProvenanceStatus { default := ProvenanceStatus.unverified; };
  prov_date: datetime;
  prov_source: str;
  multi tags: Tag;
  multi references: Entry {
    created: datetime { default := datetime_current(); };
    source: str;       # 'explicit' | 'extracted'
    confidence: float32 { default := 1.0; };
  };
  multi supersedes: Entry;
}

type Fact extending Entry {}

type Decision extending Entry {
  why: str;
  rejected: str;
  context: str;
}

type Gotcha extending Entry {
  failed: bool { default := false; };
  resolution: ResolutionStatus;
}

type Pattern extending Entry {}

type Link extending Entry {
  required url: str;
}
```

**Status:** Resolved.

---

### DD-3: Relationship metadata

**Question:** What metadata do relationships carry?

**Decision:** Link properties on EdgeDB edges:

| Property | Type | Purpose |
|----------|------|---------|
| `created` | datetime | When the relationship was established |
| `source` | str | `'explicit'` (human via `kb relate`) or `'extracted'` (parsed from text) |
| `confidence` | float32 | 1.0 for explicit, 0.0-1.0 for extracted based on pattern strength |

Bidirectionality: `references` is directional (A cites B). `linked_areas`
is directional (area A references area B). Backlinks are computed properties
(`referenced_by`, `linked_from`), not stored edges.

**Status:** Resolved.

---

### DD-4: Degraded mode

**Question:** What happens when EdgeDB is unavailable?

**Decision:** mykb must function without EdgeDB. Degraded mode:

| Command | EdgeDB up | EdgeDB down |
|---------|-----------|-------------|
| `kb add/update/delete` | Writes both stores | Writes JSONL+SQLite only, logs warning |
| `kb load` | Either store | JSONL+SQLite |
| `kb search` | SQLite FTS5 (always) | SQLite FTS5 |
| `kb traverse` | EdgeDB | Error: "graph backend unavailable" |
| `kb related` | EdgeDB | Error |
| `kb impact` | EdgeDB | Error |
| `kb tags --co-occur` | EdgeDB | Error |

On reconnect, a reconciliation pass syncs missed writes from JSONL to EdgeDB.

**Status:** Resolved.

---

### DD-5: Search strategy

**Question:** How does search work with the graph backend?

**Decision:** SQLite handles BOTH full-text search AND graph queries.
Per DD-1/DD-1a, we're starting with SQLite (not Gel). SQLite gets a
new `relationships` table alongside the existing FTS5 index:

```
JSONL (source of truth, git-tracked)
  ├──> entries: areas/<id>/*.jsonl
  └──> relationships: relationships.jsonl
           │
           └──> SQLite (derived, rebuildable)
                  ├──> entries table + FTS5 index (existing) → kb search
                  └──> relationships table (new) → kb traverse, kb related
```

Single derived store. No new infrastructure. `kb rebuild` rebuilds
everything from JSONL.

If graph queries outgrow SQLite's capabilities, Gel can be added as an
additional materialized view later — the JSONL source of truth doesn't
change.

**Status:** Resolved.

---

### DD-6: Graph traversal constraints

**Question:** How do we prevent unbounded traversal on cyclic graphs?

**Decision:**

- Default depth limit: 2
- Maximum depth limit: 5
- Edge-type filtering required for traversal queries
- Visited-node tracking to break cycles
- Return an adjacency list (nodes + edges), not a recursive tree

```typescript
export type TraversalOptions = {
  depth?: number;            // default 2, max 5
  edgeTypes?: RelationType[]; // which relationship types to follow
  zones?: Zone[];            // filter by entry zone
};

export type TraversalResult = {
  nodes: Map<string, KnowledgeEntry>;
  edges: Array<{
    from: string;
    to: string;
    type: RelationType;
    source: 'explicit' | 'extracted';
    confidence: number;
  }>;
  truncated: boolean;        // true if depth limit was hit
};
```

**Status:** Resolved.

---

### DD-7: Relationship extraction reliability

**Question:** How do we handle false positives in auto-extracted relationships?

**Decision:** Three-tier extraction:

| Tier | Pattern | Confidence | Action |
|------|---------|------------|--------|
| High | `area:<known-area-id>` | 0.95 | Auto-create edge |
| Medium | `UPPERCASE-NNN` matching a known entry ID | 0.7 | Auto-create edge with medium confidence |
| Low | `UPPERCASE-NNN` not matching known entry | 0.0 | Ignore — likely JIRA ticket or external ref |

- Only extract relationships to **known** entry IDs and area IDs
- Never guess — if the target doesn't exist in the DB, don't create an edge
- `#tag` extraction uses the existing tag field, not text parsing (tags are already structured)
- Explicit `kb relate` always creates confidence 1.0 edges

**Status:** Resolved.

---

### DD-8: JournalEntry ownership

**Question:** How are journal entries lifecycle-managed?

**Decision:** `JournalEntry` has a required back-link to `Workspace`.
Deleting a workspace cascades to its journal entries.

```esdl
type JournalEntry extending Timestamped {
  required workspace: Workspace {
    on target delete delete source;
  };
  required date: cal::local_date;
  required text: str;
}
```

**Status:** Resolved.

---

### DD-9: Backup and restore

**Question:** How is the graph data backed up?

**Decision:** JSONL is the source of truth (DD-1). Backup = git.
Relationships live in `relationships.jsonl`, so they're git-tracked like
everything else. `kb rebuild` regenerates SQLite (entries + relationships
tables) from JSONL at any time.

No new backup mechanism needed. The existing `kb save` → git commit flow
covers entries AND relationships.

**Status:** Resolved.

---

## SQLite Relationship Schema

The immediate implementation. Extends the existing `kb.db` with a
relationships table. Rebuilt from `relationships.jsonl` by `kb rebuild`.

```sql
-- New table in kb.db (alongside existing entries + FTS5 tables)
CREATE TABLE relationships (
  id          TEXT PRIMARY KEY,
  from_id     TEXT NOT NULL,    -- entry_id or 'area:<slug>'
  from_area   TEXT NOT NULL,    -- area slug of the source
  to_id       TEXT NOT NULL,    -- entry_id or 'area:<slug>'
  to_area     TEXT NOT NULL,    -- area slug of the target
  type        TEXT NOT NULL,    -- 'references' | 'supersedes' | 'linked_areas'
  source      TEXT NOT NULL DEFAULT 'explicit',  -- 'explicit' | 'extracted'
  confidence  REAL NOT NULL DEFAULT 1.0,
  created     TEXT NOT NULL,
  updated     TEXT NOT NULL
);

CREATE INDEX idx_rel_from ON relationships(from_id);
CREATE INDEX idx_rel_to ON relationships(to_id);
CREATE INDEX idx_rel_type ON relationships(type);
CREATE INDEX idx_rel_from_area ON relationships(from_area);
CREATE INDEX idx_rel_to_area ON relationships(to_area);
```

### Traversal query (SQLite recursive CTE)

"Find all entries connected to entry X within depth 2":

```sql
WITH RECURSIVE traverse(id, area, depth, path) AS (
  -- Seed: the starting entry
  SELECT to_id, to_area, 1, from_id || '->' || to_id
  FROM relationships
  WHERE from_id = :start_id AND type IN (:edge_types)
  UNION
  -- Recurse: follow edges from discovered entries
  SELECT r.to_id, r.to_area, t.depth + 1, t.path || '->' || r.to_id
  FROM relationships r
  JOIN traverse t ON r.from_id = t.id
  WHERE t.depth < :max_depth
    AND r.type IN (:edge_types)
    AND r.to_id NOT IN (SELECT id FROM traverse)  -- cycle protection
)
SELECT DISTINCT e.*
FROM traverse t
JOIN entries e ON e.id = t.id;
```

Not as clean as Cypher or EdgeQL, but it works for the current scale
(~1000 entries, ~5000 relationships) with no new infrastructure.

---

## Gel Schema (Future)

If graph query complexity outgrows SQLite, Gel (formerly EdgeDB) can be
added as an additional materialized view. This schema uses polymorphic
types as decided in DD-2.

```esdl
module default {

  abstract type Timestamped {
    required created: datetime { default := datetime_current(); };
    required updated: datetime { default := datetime_current(); };
  }

  scalar type EntryType extending enum<fact, decision, gotcha, pattern, link>;
  scalar type ZoneType extending enum<active, established, archive>;
  scalar type ProvenanceStatus extending enum<verified, unverified, stale, expires>;
  scalar type ResolutionStatus extending enum<resolved, mitigated, wontfix>;

  type Area extending Timestamped {
    required slug: str { constraint exclusive; };
    required name: str;
    summary: str;
    owner: str;
    multi tags: Tag;
    multi linked_areas: Area {
      created: datetime { default := datetime_current(); };
      source: str { default := 'explicit'; };
    };
    multi entries := .<area[is Entry];
    multi linked_from := .<linked_areas[is Area];
    multi workspaces := .<areas[is Workspace];
  }

  abstract type Entry extending Timestamped {
    required entry_id: str { constraint exclusive; };
    required area: Area;
    required text: str;
    required zone: ZoneType { default := ZoneType.active; };
    prov_status: ProvenanceStatus { default := ProvenanceStatus.unverified; };
    prov_date: datetime;
    prov_source: str;
    multi tags: Tag;
    multi references: Entry {
      created: datetime { default := datetime_current(); };
      source: str { default := 'explicit'; };
      confidence: float32 { default := 1.0; };
    };
    multi supersedes: Entry;
    multi referenced_by := .<references[is Entry];
    multi superseded_by := .<supersedes[is Entry];
  }

  type Fact extending Entry {}
  type Decision extending Entry {
    why: str;
    rejected: str;
    context: str;
  }
  type Gotcha extending Entry {
    failed: bool { default := false; };
    resolution: ResolutionStatus;
  }
  type Pattern extending Entry {}
  type Link extending Entry {
    required url: str;
  }

  type Tag {
    required name: str { constraint exclusive; };
    multi entries := .<tags[is Entry];
    multi areas := .<tags[is Area];
  }

  type Workspace extending Timestamped {
    required slug: str { constraint exclusive; };
    required name: str;
    phase: str;
    active_task: str;
    blocked: str;
    next_task: str;
    multi areas: Area;
    jira: str;
    wiki: str;
    multi repos: str;
    multi journal := .<workspace[is JournalEntry];
  }

  type JournalEntry extending Timestamped {
    required workspace: Workspace {
      on target delete delete source;
    };
    required date: cal::local_date;
    required text: str;
  }
}
```

---

## Interface (Draft)

```typescript
export type RelationType = 'references' | 'supersedes' | 'linked_areas';

export type RelationSource = 'explicit' | 'extracted';

export type TraversalOptions = {
  depth?: number;              // default 2, max 5
  edgeTypes?: RelationType[];
  zones?: Zone[];
};

export type TraversalResult = {
  nodes: Map<string, KnowledgeEntry>;
  edges: Array<{
    from: string;
    to: string;
    type: RelationType;
    source: RelationSource;
    confidence: number;
  }>;
  truncated: boolean;
};

export interface GraphStore {
  // Relationship management
  relate(fromId: string, toId: string, type: RelationType): void;
  unrelate(fromId: string, toId: string, type: RelationType): void;

  // Graph queries
  traverse(id: string, options?: TraversalOptions): TraversalResult;
  related(area: string, options?: TraversalOptions): TraversalResult;
  impact(id: string): TraversalResult;
  tagCoOccurrence(tag: string): Array<{ tag: string; count: number }>;

  // Health
  isAvailable(): Promise<boolean>;
}
```

---

## Open — Blocking

None. All design decisions resolved. Ready for implementation planning.

## Open — Non-blocking

1. Performance benchmarks: SQLite recursive CTEs at mykb scale (~1000 entries, ~5000 edges)
2. Gel deployment model if/when SQLite is outgrown (local vs Docker vs cloud)
3. GraphQL exposure — only relevant if Gel is added
4. Relationship visualization (`kb graph` output format — Mermaid? DOT? interactive?)
5. Should `kb relate` be a separate command or integrated into `kb add` with `--references` flag?

---

## Iteration Log

| Date | Change |
|------|--------|
| 2026-03-18 | Iteration 1: Separated from motivation doc. Addressed review: polymorphic types, relationship metadata, cycle protection, degraded mode, search strategy, JournalEntry ownership, extraction reliability. DD-1 (source of truth) left unresolved. |
| 2026-03-18 | Iteration 2: Resolved DD-1. Research found: EdgeDB renamed to Gel (no embedded mode), Graphiti event-sourcing pattern, N-Triples as git-friendly graph format. Key insight: relationships CAN live in JSONL. Decision: JSONL stays source of truth with `relationships.jsonl` for graph edges. Gel demoted from primary store to optional future materialized view. SQLite with relationship table is the immediate implementation. Added SQLite schema with recursive CTE traversal. Resolved DD-5 (search) and DD-9 (backup) as consequences of DD-1. All DDs now resolved. |
