# Graph Backend — Design Document

**Date:** 2026-03-18
**Status:** Draft — Iteration 3
**Prerequisite:** [graph-backend-MOTIVATION.md](./graph-backend-MOTIVATION.md)

---

## Trajectory

mykb is a personal knowledge base today. It is being designed to become a
corporate knowledge base. The architecture must support:

- **Multi-user** — multiple humans and AI agents reading/writing concurrently
- **Access control** — who can see/edit which areas
- **Audit trail** — who changed what, when, and why
- **API access** — GraphQL endpoint for external tools and services
- **Scale** — thousands of areas, tens of thousands of entries, millions of relationships
- **Concurrency** — no single-writer bottleneck (SQLite BUSY is already a known issue)

This rules out SQLite as the long-term query engine. PostgreSQL via Gel
is the right foundation.

---

## Design Decisions

### DD-1: Source of truth

**Question:** Where does the canonical data live?

**Context:** Iteration 2 concluded "JSONL stays source of truth, Gel is a
derived view." That was designed for a single-user personal tool. A
corporate KB changes the calculus:

- Multiple users writing concurrently → need ACID transactions
- Access control → need row/object-level permissions
- Audit trail → need server-side change tracking
- API access → need a live queryable store, not files on one person's disk
- JSONL on disk is one user's filesystem — it cannot be the shared source
  of truth for a team

**Decision: Gel (PostgreSQL) is the source of truth.**

JSONL becomes the portable import/export format:
- `kb export` — dump the graph to JSONL for git archival, migration, or backup
- `kb import` — load JSONL into Gel (bootstrapping, migration from v1)
- JSONL exports are snapshots, not the live source of truth

```
Gel on PostgreSQL (source of truth)
  │
  ├── All reads and writes go here
  ├── Relationships are native graph edges
  ├── Full-text search via PostgreSQL tsvector
  ├── Access control via Gel's auth model
  ├── Audit trail via trigger-based change log
  │
  └──> JSONL export (portable, git-archivable)
       └── kb export → ~/.mykb/export/
           ├── areas/<id>/*.jsonl
           └── relationships.jsonl
```

**Migration path from v1:**
1. Deploy Gel instance
2. `kb import ~/.mykb/` — loads all JSONL into Gel
3. Run relationship extractor on imported entries
4. Verify: `kb export` produces equivalent JSONL
5. Switch `kb` CLI to use Gel backend
6. JSONL files become archive — no longer written to directly

**Offline / degraded mode:** The CLI needs network access to Gel. For
offline scenarios, a read-only SQLite cache can be maintained locally
(same as today) for `kb load` and `kb search`. Writes queue locally and
sync on reconnect.

**Status:** Resolved.

---

### DD-2: Entry type modeling

**Decision:** Polymorphic subtypes. Gel's type system supports this natively.

```esdl
abstract type Entry extending Timestamped {
  required entry_id: str { constraint exclusive; };
  required area: Area;
  required text: str;
  required zone: ZoneType { default := ZoneType.active; };

  # Provenance
  prov_status: ProvenanceStatus { default := ProvenanceStatus.unverified; };
  prov_date: datetime;
  prov_source: str;

  # Relationships
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

  # Audit
  created_by: User;
  updated_by: User;
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

**Decision:** Link properties on Gel edges:

| Property | Type | Purpose |
|----------|------|---------|
| `created` | datetime | When the relationship was established |
| `source` | str | `'explicit'` (human/agent via `kb relate`) or `'extracted'` (parsed from text) |
| `confidence` | float32 | 1.0 for explicit, 0.0-1.0 for extracted |

Bidirectionality: `references` is directional (A cites B). `linked_areas`
is directional (area A references area B). Backlinks are computed properties
(`referenced_by`, `linked_from`), not stored edges.

**Status:** Resolved.

---

### DD-4: Degraded mode

**Question:** What happens when Gel is unavailable?

**Decision:** Core read operations fall back to a local SQLite cache.
Write operations queue locally and sync on reconnect.

| Command | Gel up | Gel down |
|---------|--------|----------|
| `kb add/update/delete` | Writes to Gel | Queues to local write-ahead log, syncs on reconnect |
| `kb load` | Gel | Local SQLite cache (may be stale) |
| `kb search` | Gel (PostgreSQL FTS) | Local SQLite FTS5 cache |
| `kb traverse` | Gel | Unavailable (graph queries need Gel) |
| `kb related` | Gel | Unavailable |
| `kb impact` | Gel | Unavailable |
| `kb relate` | Writes to Gel | Queues locally |

The local SQLite cache is refreshed periodically when Gel is available
(`kb sync`). This ensures basic read operations work offline.

**Status:** Resolved.

---

### DD-5: Search strategy

**Decision:** PostgreSQL's built-in full-text search (`tsvector` +
`tsquery`) replaces SQLite FTS5 as the primary search engine. Gel exposes
this through its query language.

For degraded/offline mode, the local SQLite cache maintains an FTS5 index
as a fallback.

```
Gel on PostgreSQL (primary)
  ├── Graph queries: EdgeQL
  ├── Full-text search: PostgreSQL tsvector
  ├── GraphQL API: built-in
  │
  └──> Local SQLite cache (offline fallback)
       ├── Entries table + FTS5 (for kb load, kb search)
       └── Refreshed via kb sync
```

**Status:** Resolved.

---

### DD-6: Graph traversal constraints

**Decision:** Same as iteration 2 — depth limits, edge-type filtering,
cycle protection, adjacency list return format.

```typescript
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
    source: 'explicit' | 'extracted';
    confidence: number;
  }>;
  truncated: boolean;
};
```

**Status:** Resolved.

---

### DD-7: Relationship extraction reliability

**Decision:** Same as iteration 2 — three-tier extraction with confidence
scores. Only extract to known IDs. Explicit `kb relate` = confidence 1.0.

**Status:** Resolved.

---

### DD-8: JournalEntry ownership

**Decision:** Required back-link to Workspace with cascade delete.

**Status:** Resolved.

---

### DD-9: Backup and restore

**Decision:** Gel (PostgreSQL) is backed up via:
- `pg_dump` / `pg_restore` — standard PostgreSQL backup
- `kb export` — JSONL snapshot for human-readable archive and git
- For managed Gel Cloud: automatic backups included

JSONL exports can be committed to git for historical snapshots, but they
are not the live source of truth.

**Status:** Resolved.

---

### DD-10: Multi-tenancy and access control

**Question:** How do multiple users access the KB with different permissions?

**Decision:** Gel's built-in access policies. Define roles and scoped
access at the object level.

```esdl
# Access control types
type User extending Timestamped {
  required email: str { constraint exclusive; };
  required name: str;
  multi roles: Role;
}

type Role {
  required name: str { constraint exclusive; };
  multi areas: Area;            # areas this role can access
  required can_read: bool { default := true; };
  required can_write: bool { default := false; };
  required can_admin: bool { default := false; };
}

# Access policy on Entry
abstract type Entry extending Timestamped {
  # ... (existing fields) ...

  access policy allow_read
    allow select
    using (
      global current_user.roles.areas ?= .area
      and global current_user.roles.can_read = true
    );

  access policy allow_write
    allow insert, update, delete
    using (
      global current_user.roles.areas ?= .area
      and global current_user.roles.can_write = true
    );
}
```

For the personal KB phase (now), a single user with admin on all areas.
Corporate phase adds roles per team/project.

**Status:** Resolved.

---

### DD-11: Audit trail

**Question:** How do we track who changed what?

**Decision:** A change log table with trigger-based population.

```esdl
type ChangeLog extending Timestamped {
  required action: str;           # 'create' | 'update' | 'delete'
  required target_type: str;      # 'Entry' | 'Area' | 'Workspace' | 'Relationship'
  required target_id: str;
  user: User;
  agent: str;                     # agent identifier if change was by AI
  previous_value: json;           # snapshot before change (for updates/deletes)
  new_value: json;                # snapshot after change (for creates/updates)
}
```

Every write operation generates a ChangeLog entry. This provides:
- Full audit trail for compliance
- "Who changed this?" queries
- Undo capability (restore from `previous_value`)
- Agent attribution (which AI agent modified which entries)

**Status:** Resolved.

---

## Gel Schema (Complete)

```esdl
module default {

  # --- Scalar types ---

  scalar type EntryType extending enum<fact, decision, gotcha, pattern, link>;
  scalar type ZoneType extending enum<active, established, archive>;
  scalar type ProvenanceStatus extending enum<verified, unverified, stale, expires>;
  scalar type ResolutionStatus extending enum<resolved, mitigated, wontfix>;

  # --- Abstract types ---

  abstract type Timestamped {
    required created: datetime { default := datetime_current(); };
    required updated: datetime { default := datetime_current(); };
  }

  # --- Identity and access ---

  type User extending Timestamped {
    required email: str { constraint exclusive; };
    required name: str;
    multi roles: Role;
  }

  type Role {
    required name: str { constraint exclusive; };
    multi areas: Area;
    required can_read: bool { default := true; };
    required can_write: bool { default := false; };
    required can_admin: bool { default := false; };
  }

  # --- Knowledge graph ---

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

    # Provenance
    prov_status: ProvenanceStatus { default := ProvenanceStatus.unverified; };
    prov_date: datetime;
    prov_source: str;

    # Relationships
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

    # Audit
    created_by: User;
    updated_by: User;
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

  # --- Workspaces ---

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

  # --- Audit ---

  type ChangeLog extending Timestamped {
    required action: str;
    required target_type: str;
    required target_id: str;
    user: User;
    agent: str;
    previous_value: json;
    new_value: json;
  }
}
```

---

## GraphStore Interface

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

export interface GraphStore extends KnowledgeStore {
  // Relationship management
  relate(fromId: string, toId: string, type: RelationType): void;
  unrelate(fromId: string, toId: string, type: RelationType): void;

  // Graph queries
  traverse(id: string, options?: TraversalOptions): TraversalResult;
  related(area: string, options?: TraversalOptions): TraversalResult;
  impact(id: string): TraversalResult;
  tagCoOccurrence(tag: string): Array<{ tag: string; count: number }>;

  // Import/export
  exportJsonl(path: string): void;
  importJsonl(path: string): void;

  // Health and sync
  isAvailable(): Promise<boolean>;
  syncToCache(): Promise<void>;    // refresh local SQLite cache
}
```

---

## Deployment

### Personal KB (now)

```
Developer workstation
  └── docker compose up
        ├── gel (PostgreSQL)     ← persistent volume
        └── (optional) gel-ui   ← admin dashboard
```

Single `docker compose` with a persistent volume. Zero ops.

### Corporate KB (future)

```
Infrastructure
  ├── Gel Cloud or self-hosted Gel on managed PostgreSQL
  ├── GraphQL API exposed to internal network
  ├── Auth via SSO / OIDC
  └── Multiple kb CLI instances + AI agents connecting
```

The same Gel schema and API. Only the deployment changes.

---

## Migration from v1

| Step | Action | Reversible |
|------|--------|------------|
| 1 | Deploy Gel instance (`docker compose up`) | Yes — remove container |
| 2 | `kb import ~/.mykb/` — load all JSONL into Gel | Yes — Gel is empty, just reimport |
| 3 | Run relationship extractor on imported entries | Yes — delete extracted edges |
| 4 | `kb export` — verify round-trip produces equivalent JSONL | N/A — validation only |
| 5 | Switch kb CLI to Gel backend (config change) | Yes — switch back to JSONL |
| 6 | Archive `~/.mykb/` JSONL files (no longer written to) | Yes — re-enable JSONL backend |

v1 JSONL backend is not removed — it stays as a fallback and for the
local offline cache.

---

## Open — Non-blocking

1. Gel deployment model — Docker Compose for now, managed for corporate
2. Relationship visualization — `kb graph` output format (Mermaid? DOT?)
3. `kb relate` UX — separate command or `--references` flag on `kb add`
4. Offline cache sync frequency and conflict resolution
5. Agent identity model — how do AI agents authenticate to Gel?
6. JSONL export scheduling — automatic nightly? manual? git hook?

---

## Iteration Log

| Date | Change |
|------|--------|
| 2026-03-18 | Iteration 1: Separated from motivation doc. Addressed review: polymorphic types, relationship metadata, cycle protection, degraded mode, search strategy, JournalEntry ownership, extraction reliability. DD-1 left unresolved. |
| 2026-03-18 | Iteration 2: Resolved DD-1 as "JSONL stays source of truth." Research: Gel has no embedded mode, Graphiti event-sourcing pattern, N-Triples. SQLite with relationship table as immediate impl. |
| 2026-03-18 | Iteration 3: Reversed DD-1. mykb targets corporate KB, not just personal. Multi-user, access control, audit trail, concurrency, and API access require PostgreSQL. Gel becomes source of truth. JSONL becomes import/export format. Added DD-10 (access control), DD-11 (audit trail). PostgreSQL FTS replaces SQLite FTS5. Local SQLite cache for offline fallback. Migration plan from v1. |
