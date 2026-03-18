# Graph Backend — Design Document

**Date:** 2026-03-18
**Status:** Draft — Iteration 1
**Prerequisite:** [graph-backend-MOTIVATION.md](./graph-backend-MOTIVATION.md)

---

## Design Decisions To Resolve

These are the hard architectural questions identified during review. Each
must have a clear answer before implementation begins.

### DD-1: Source of truth

**Question:** Does JSONL remain the source of truth, or does EdgeDB become it?

**The tension:** Explicit relationships (`kb relate A B`) have no natural
JSONL representation. If JSONL is source of truth, `kb rebuild --edgedb`
loses relationships. If EdgeDB is source of truth, we lose git-tracked
diffs and offline operation.

**Options:**

| Option | Pros | Cons |
|--------|------|------|
| A: JSONL stays source of truth | Git history, offline, portable, proven | Relationships lost on rebuild. Need a `relationships.jsonl` that breaks per-area model. |
| B: EdgeDB becomes source of truth | Relationships are native. Single store. | No git diffs. Offline breaks. Need `edgedb dump` for backup. |
| C: Hybrid — JSONL for entries, EdgeDB for relationships | Each store owns what it's good at. JSONL stays git-tracked. | Two sources of truth. Consistency is complex. |
| D: EdgeDB source of truth + JSONL export | EdgeDB owns all data. `kb export` generates JSONL for git archival. | Export is a snapshot, not append-only. Git diffs are noisy. |

**Status:** Unresolved.

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

**Question:** EdgeDB has no FTS5 equivalent. How does search work?

**Decision:** Keep SQLite FTS5 for full-text search. EdgeDB handles
graph queries. This is a three-store system:

```
JSONL (source of truth / git-tracked)
  ├──> SQLite FTS5 (full-text search — kb search)
  └──> EdgeDB (graph queries — kb traverse, kb related, kb impact)
```

Or if DD-1 resolves to EdgeDB as source of truth:

```
EdgeDB (source of truth)
  ├──> SQLite FTS5 (full-text search — derived, rebuildable)
  └──> JSONL (export format — derived, for git archival)
```

**Status:** Depends on DD-1.

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

**Depends on DD-1:**

- If JSONL is source of truth: `kb rebuild --edgedb` restores everything
  except explicit relationships (which are lost — this is the DD-1 tension)
- If EdgeDB is source of truth: `edgedb dump` / `edgedb restore` for full
  backup. `kb export --jsonl` for human-readable snapshot.
- If hybrid: both mechanisms needed.

**Status:** Depends on DD-1.

---

## Schema (Draft)

Pending resolution of DD-1. The schema below assumes DD-2 through DD-8
are resolved as stated above.

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

    # Computed backlinks
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

    # Computed backlinks
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

1. **DD-1 must be resolved** before implementation. Everything else flows
   from the source-of-truth decision.

## Open — Non-blocking

2. EdgeDB deployment model (local vs Docker vs cloud)
3. Performance benchmarks at mykb scale (~1000 entries, ~5000 edges)
4. GraphQL exposure — internal only or external API?
5. Access control model for graph queries
6. Migration tooling from JSONL to EdgeDB (bulk import)

---

## Iteration Log

| Date | Change |
|------|--------|
| 2026-03-18 | Initial draft. Separated from motivation doc. Addressed review: polymorphic types, relationship metadata, cycle protection, degraded mode, search strategy, JournalEntry ownership, extraction reliability. DD-1 (source of truth) left unresolved. |
