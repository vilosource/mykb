# Graph Backend — Design Document

**Date:** 2026-03-18
**Status:** Draft — Iteration 4
**Prerequisite:** [graph-backend-MOTIVATION.md](./graph-backend-MOTIVATION.md)

---

## Trajectory

mykb is a personal knowledge base today. It is being designed to become a
corporate knowledge base. The architecture must support:

- **Multi-user** — multiple humans and AI agents reading/writing concurrently
- **Multiple vf-agents instances** — concurrent agent access to shared knowledge
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

**Decision: Gel (PostgreSQL) is the source of truth.**

A corporate KB needs ACID transactions, concurrent access, access control,
and audit trail. JSONL on one user's disk cannot serve as the shared source
of truth for a team of humans and AI agents.

JSONL becomes the portable import/export format:
- `kb export` — dump the graph to JSONL for git archival, migration, or backup
- `kb import` — load JSONL into Gel (bootstrapping, migration from v1)

```
Gel on PostgreSQL (source of truth)
  │
  ├── All reads and writes go here
  ├── Relationships are native graph edges
  ├── Full-text search via PostgreSQL tsvector
  ├── Access control via Gel's auth model
  ├── Audit trail via application-level change log
  │
  └──> JSONL export (portable, git-archivable)
       └── kb export → ~/.mykb/export/
           ├── areas/<id>/*.jsonl
           └── relationships.jsonl
```

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

**Analysis:** The previous iteration proposed a write-ahead log (WAL) for
offline writes that sync on reconnect. This is a distributed systems
conflict resolution problem:

- What if two agents modify the same entry — one offline, one on Gel?
- What if an entry is updated offline but deleted on Gel before sync?
- What if offline relationships point to entries deleted on Gel?

This complexity is not justified by the actual use cases:

- **Personal KB (now):** Gel is a local Docker container. If it's down,
  `docker compose up`. Offline window is minutes.
- **Corporate KB (future):** Gel on managed PostgreSQL with HA. Downtime
  is an infrastructure incident, not a normal operating mode.

Offline writes are an edge case in both scenarios. Building a WAL with
conflict resolution adds distributed systems complexity that will be
buggy, rarely used, and hard to test.

**Decision: Reads fall back to SQLite cache. Writes fail with a clear error.**

| Command | Gel up | Gel down |
|---------|--------|----------|
| `kb add/update/delete` | Writes to Gel | **Error: "Gel unavailable. Writes require a running Gel instance."** |
| `kb load` | Gel | Local SQLite cache (may be stale, warns user) |
| `kb search` | Gel (PostgreSQL FTS) | Local SQLite FTS5 cache |
| `kb traverse` | Gel | Error: "graph queries require Gel" |
| `kb related` | Gel | Error |
| `kb impact` | Gel | Error |
| `kb relate` | Writes to Gel | Error |

The local SQLite cache is refreshed on every successful `kb load` or via
explicit `kb sync`. When Gel comes back, everything works immediately —
no reconciliation needed.

If offline writes become a real need in the future, that's a separate
design exercise with proper CRDT or event-sourcing semantics. Not
something to half-bake into v2.

**Status:** Resolved.

---

### DD-5: Search strategy

**Decision:** PostgreSQL's built-in full-text search (`tsvector` +
`tsquery`) replaces SQLite FTS5 as the primary search engine.

Local SQLite cache maintains FTS5 for offline read fallback.

```
Gel on PostgreSQL (primary)
  ├── Graph queries: EdgeQL
  ├── Full-text search: PostgreSQL tsvector
  ├── GraphQL API: built-in
  │
  └──> Local SQLite cache (offline read fallback)
       ├── Entries table + FTS5 (for kb load, kb search)
       └── Refreshed on every successful kb load / kb sync
```

**Status:** Resolved.

---

### DD-6: Graph traversal constraints

**Decision:** Depth limits, edge-type filtering, cycle protection,
adjacency list return format.

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

**Decision:** Three-tier extraction with confidence scores:

| Tier | Pattern | Confidence | Action |
|------|---------|------------|--------|
| High | `area:<known-area-id>` | 0.95 | Auto-create edge |
| Medium | `UPPERCASE-NNN` matching a known entry ID | 0.7 | Auto-create edge |
| Low | `UPPERCASE-NNN` not matching known entry | 0.0 | Ignore |

Only extract relationships to **known** entry IDs and area IDs. Never
guess. Tags use the existing structured tag field, not text parsing.
Explicit `kb relate` always creates confidence 1.0 edges.

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

**Status:** Resolved.

---

### DD-10: Multi-tenancy and access control

**Question:** How do multiple users access the KB with different permissions?

**Decision:** Gel's built-in access policies with role-based area scoping.

```esdl
global current_user_id: uuid;

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
```

**Access policy on Entry:**

```esdl
abstract type Entry extending Timestamped {
  # ... fields ...

  access policy allow_admin
    allow all
    using (
      exists (
        (select User filter .id = global current_user_id).roles
        filter .can_admin = true
      )
    );

  access policy allow_read
    allow select
    using (
      exists (
        (select User filter .id = global current_user_id).roles
        filter __subject__.area in .areas and .can_read = true
      )
    );

  access policy allow_write
    allow insert, update, delete
    using (
      exists (
        (select User filter .id = global current_user_id).roles
        filter __subject__.area in .areas and .can_write = true
      )
    );
}
```

Policy evaluation:
- `allow_admin`: if the current user has ANY role with `can_admin = true`,
  allow everything regardless of area. This is the superuser path.
- `allow_read`: if the current user has ANY role that includes this entry's
  area AND has `can_read = true`, allow select.
- `allow_write`: same check but for `can_write`.

For the personal KB phase: a single user with one role (`admin`) that has
`can_admin = true`. All areas accessible, all operations allowed. Zero
friction.

Corporate phase: roles per team/project. The infrastructure team's role
includes `infra-*` areas. The Stark project role includes `stark-picking`.
A user can have multiple roles.

**Status:** Resolved.

---

### DD-11: Audit trail

**Question:** How do we track who changed what?

**Analysis:** Gel does not have PostgreSQL-style database triggers. The
audit trail must be implemented at the application level. Two options:

1. **Inline**: every write method in the store manually creates a ChangeLog
   entry. Easy to forget when adding new methods.
2. **Decorator pattern**: an `AuditedStore` wrapper intercepts all write
   calls, delegates to the underlying `GelStore`, and creates ChangeLog
   entries in the same transaction. Cannot be bypassed.

**Decision: Decorator pattern.**

```typescript
class AuditedStore implements KnowledgeWriter, GraphQuerier {
  constructor(
    private store: GelStore,
    private getCurrentUser: () => User | null,
    private getAgentId: () => string | null,
  ) {}

  addFact(area: string, text: string, options?: AddFactOptions): string {
    const id = this.store.addFact(area, text, options);
    this.store.logChange({
      action: 'create',
      targetType: 'Fact',
      targetId: id,
      user: this.getCurrentUser(),
      agent: this.getAgentId(),
      newValue: { area, text, ...options },
    });
    return id;
  }

  // ... same pattern for all write methods
}
```

The `AuditedStore` wraps `GelStore`. All CLI commands and API endpoints
use `AuditedStore`, never `GelStore` directly. This guarantees every
write is audited.

```esdl
type ChangeLog extending Timestamped {
  required action: str;           # 'create' | 'update' | 'delete'
  required target_type: str;      # 'Fact' | 'Decision' | 'Area' | ...
  required target_id: str;
  user: User;
  agent: str;                     # agent identifier (e.g., 'curator', 'pi-stark')
  previous_value: json;
  new_value: json;
}
```

**Status:** Resolved.

---

### DD-12: Interface architecture

**Question:** How do the Gel store, SQLite cache, and CLI interact?

**Analysis (from review):** `GraphStore extends KnowledgeStore` forces
the SQLite cache to implement write methods it shouldn't have. The
interface needs to be split by capability.

**Decision: Three interfaces, composed by role.**

```typescript
// --- Read interface (Gel + SQLite cache both implement) ---

export interface KnowledgeReader {
  loadArea(area: string, filter?: EntryFilter): KnowledgeEntry[];
  search(query: string): KnowledgeEntry[];
  matchAreas(text: string): { area: string; score: number }[];
  getArea(area: string): AreaMetadata | null;
  listAreas(): AreaMetadata[];
}

// --- Write interface (Gel only) ---

export interface KnowledgeWriter {
  addFact(area: string, text: string, options?: AddFactOptions): string;
  addDecision(area: string, text: string, options?: AddDecisionOptions): string;
  addGotcha(area: string, text: string, options?: AddGotchaOptions): string;
  addPattern(area: string, text: string, options?: AddPatternOptions): string;
  addLink(area: string, text: string, url: string, options?: AddLinkOptions): string;
  updateEntry(area: string, id: string, updates: Partial<KnowledgeEntry>): void;
  deleteEntry(area: string, id: string): void;
  verifyEntry(area: string, id: string): void;
  promoteEntry(area: string, id: string): void;
  archiveEntry(area: string, id: string): void;
  initArea(id: string, name: string, summary?: string): void;
}

// --- Graph interface (Gel only) ---

export interface GraphQuerier {
  relate(fromId: string, toId: string, type: RelationType): void;
  unrelate(fromId: string, toId: string, type: RelationType): void;
  traverse(id: string, options?: TraversalOptions): TraversalResult;
  related(area: string, options?: TraversalOptions): TraversalResult;
  impact(id: string): TraversalResult;
  tagCoOccurrence(tag: string): Array<{ tag: string; count: number }>;
}

// --- Import/export ---

export interface Portable {
  exportJsonl(path: string): void;
  importJsonl(path: string): void;
}

// --- Health ---

export interface HealthCheckable {
  isAvailable(): Promise<boolean>;
}

// --- Implementations ---

// Gel: full capabilities
class GelStore implements KnowledgeReader, KnowledgeWriter,
                          GraphQuerier, Portable, HealthCheckable { ... }

// SQLite cache: read-only fallback
class SqliteCacheStore implements KnowledgeReader {
  syncFrom(source: KnowledgeReader): Promise<void>;
}

// Audited wrapper: wraps GelStore, adds change logging
class AuditedStore implements KnowledgeWriter, GraphQuerier {
  constructor(private store: GelStore) { ... }
}
```

**CLI routing:**

```typescript
class KbClient {
  private gel: GelStore;
  private cache: SqliteCacheStore;
  private writer: AuditedStore;

  async read(): KnowledgeReader {
    if (await this.gel.isAvailable()) return this.gel;
    console.warn('Gel unavailable, using cached data (may be stale)');
    return this.cache;
  }

  write(): KnowledgeWriter {
    // No fallback — writes require Gel (DD-4)
    return this.writer;
  }

  graph(): GraphQuerier {
    // No fallback — graph queries require Gel (DD-4)
    return this.writer;
  }
}
```

This makes the degraded mode explicit in the type system. `KnowledgeReader`
can come from either store. `KnowledgeWriter` and `GraphQuerier` only come
from Gel. A caller cannot accidentally write to the cache.

**Status:** Resolved.

---

### DD-13: Tag structure

**Question:** Are flat string tags sufficient for corporate use?

**Analysis:** Personal use: flat tags work. `#vault #ssl #networking`.
Corporate use: 50+ users tagging across hundreds of areas leads to:
- Tag sprawl: `vault`, `Vault`, `hashicorp-vault`, `hcvault` all meaning the same thing
- No discoverability: "what tags exist in this domain?"
- No grouping: `ssl` and `vault` are both security-related but there's no way to query "all security tags"

Over-engineering risk: full taxonomy with hierarchies, ontologies, and
governance is overkill for a KB that has ~200 tags today.

**Decision: Add `category` and `description` to Tag. No hierarchy.**

```esdl
type Tag {
  required name: str { constraint exclusive; };
  category: str;                  # e.g., 'technology', 'customer', 'workflow', 'infrastructure'
  description: str;               # what this tag means, for discoverability
  multi entries := .<tags[is Entry];
  multi areas := .<tags[is Area];
}
```

- `category` enables grouping: "show me all technology tags", "show me all customer tags"
- `description` enables discoverability: "what does `agw` mean?" → "Auth Gateway — Optiscan shared authentication proxy"
- Both fields are optional — personal use ignores them, corporate use populates them
- No hierarchy — if needed later, add `parent: Tag` as a future schema migration

Tag normalization (preventing `vault` vs `Vault` vs `hcvault`):
- Tags are stored lowercase, enforced at write time
- `kb tags list` shows all tags with categories and descriptions
- `kb tags merge <source> <target>` consolidates duplicates

**Status:** Resolved.

---

### DD-14: Active workspace (per-session)

**Note:** This was flagged in the review but is already solved in v1.

The active workspace is **client-side state**, not server-side. The
`KB_SESSION_ID` env var → per-session temp file pattern (see
`session-isolation-DESIGN.md`) handles concurrent sessions correctly.

This design carries forward to v2 unchanged. The Gel schema does not need
a `User.active_workspace` field. Each CLI session tracks its own active
workspace locally.

**Status:** Already resolved in v1. No change needed.

---

## Gel Schema (Complete)

```esdl
module default {

  # --- Globals ---

  global current_user_id: uuid;

  # --- Scalar types ---

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

    # Access policies
    access policy allow_admin
      allow all
      using (
        exists (
          (select User filter .id = global current_user_id).roles
          filter .can_admin = true
        )
      );

    access policy allow_read
      allow select
      using (
        exists (
          (select User filter .id = global current_user_id).roles
          filter __subject__.area in .areas and .can_read = true
        )
      );

    access policy allow_write
      allow insert, update, delete
      using (
        exists (
          (select User filter .id = global current_user_id).roles
          filter __subject__.area in .areas and .can_write = true
        )
      );
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
    category: str;
    description: str;
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

## Deployment

### Personal KB (now)

```
Developer workstation
  └── docker compose up
        ├── gel (PostgreSQL)     ← persistent volume
        └── (optional) gel-ui   ← admin dashboard
```

Single `docker compose` with a persistent volume.

### Corporate KB (future)

```
Infrastructure
  ├── Gel Cloud or self-hosted Gel on managed PostgreSQL
  ├── GraphQL API exposed to internal network
  ├── Auth via SSO / OIDC
  └── Multiple kb CLI instances + vf-agents connecting
```

Same Gel schema and API. Only the deployment changes.

---

## Migration from v1

| Step | Action | Reversible |
|------|--------|------------|
| 1 | Deploy Gel instance (`docker compose up`) | Yes |
| 2 | `kb import ~/.mykb/` — load all JSONL into Gel | Yes |
| 3 | Run relationship extractor on imported entries | Yes |
| 4 | `kb export` — verify round-trip fidelity | N/A |
| 5 | Switch kb CLI to Gel backend (config change) | Yes |
| 6 | Archive `~/.mykb/` JSONL files | Yes |

**Export round-trip mapping:** v1 JSONL has `provenance: { status, date, source }` as
a nested object. Gel schema flattens to `prov_status`, `prov_date`, `prov_source`.
The import/export code must map between these representations. This mapping must be
tested explicitly in step 4 — field-by-field comparison, not just entry count.

v1 JSONL backend stays as fallback and for the local SQLite offline cache.

---

## Open — Non-blocking

1. Gel deployment — Docker Compose for now, managed for corporate
2. Relationship visualization — `kb graph` output format (Mermaid? DOT?)
3. `kb relate` UX — separate command or `--references` flag on `kb add`
4. Agent identity — how do AI agents authenticate to Gel? API key per agent? Shared service account?
5. JSONL export scheduling — automatic nightly? manual? git hook?
6. Data retention — ChangeLog pruning policy, archive entry TTL

---

## Iteration Log

| Date | Change |
|------|--------|
| 2026-03-18 | Iteration 1: Separated from motivation doc. Addressed review: polymorphic types, relationship metadata, cycle protection, degraded mode, search strategy, JournalEntry ownership, extraction reliability. DD-1 left unresolved. |
| 2026-03-18 | Iteration 2: Resolved DD-1 as "JSONL stays source of truth." Research: Gel has no embedded mode, Graphiti event-sourcing, N-Triples. SQLite with relationship table as immediate impl. |
| 2026-03-18 | Iteration 3: Reversed DD-1. mykb targets corporate KB. Gel becomes source of truth. Added DD-10 (access control), DD-11 (audit trail). |
| 2026-03-18 | Iteration 4: Addressed review findings. (1) DD-4 simplified: no offline WAL — writes fail when Gel is down, reads fall back to SQLite cache. Offline writes are an edge case that doesn't justify distributed systems complexity. (2) DD-10 access policies rewritten with correct Gel syntax — checks ANY role grants access, admin bypasses area restrictions. (3) DD-11 audit uses decorator pattern (AuditedStore wraps GelStore) since Gel lacks triggers. (4) DD-12 added: interface split into KnowledgeReader (Gel + SQLite), KnowledgeWriter (Gel only), GraphQuerier (Gel only). SQLite cache cannot accidentally receive writes. (5) DD-13 added: Tag gets category + description fields for corporate tag governance. No hierarchy — add later if needed. (6) DD-14 added: active workspace is client-side (KB_SESSION_ID), already solved in v1, no schema change needed. Removed unused EntryType enum from schema. |
