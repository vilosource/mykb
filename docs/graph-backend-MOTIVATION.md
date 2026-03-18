# Graph Backend — Motivation

**Date:** 2026-03-18
**Status:** Accepted
**Scope:** Why mykb needs a graph-relational storage backend

---

## 1. What We Have Today

mykb v1 uses a JSONL + SQLite hybrid:
- **JSONL files** per area/type — git-tracked, append-only, source of truth
- **SQLite FTS5** — gitignored cache, rebuilt from JSONL, keyword search
- **Interfaces** — `KnowledgeStore` and `WorkspaceStorage` abstract the storage
  (see `src/core/types.ts`)

This works well for basic CRUD and keyword search. The interface abstraction
was a deliberate design choice — storage backends are pluggable.

---

## 2. What's Missing

### Relationships are invisible

When an entry in `stark-picking` references `area:infra-vm` or
`decision:VM-PROV-001`, that's just text — not a traversable link. The
system cannot:

- Find everything connected to a concept across all areas
- Traverse dependency chains (decision A led to decision B)
- Discover implicit clusters (entries sharing tags across areas)
- Answer "what areas are affected if I change X?"
- Show how workspaces, areas, entries, and tags form a knowledge graph

### Cross-area queries are weak

`kb search` does keyword matching across all areas. But "show me everything
related to Vault Agent SSL" requires understanding relationships, not just
matching the string "vault".

### Tags are flat

Tags exist on entries but aren't queryable as a connected structure. You
can't ask "what tags co-occur?" or "what's the tag cloud for this
workspace?"

### The data IS a graph

The knowledge base has natural graph structure:

```
workspace:stark-picking ──[has_area]──> area:stark-picking
area:stark-picking ──[links_to]──> area:infra-vm
entry:STARK-002 ──[references]──> entry:VM-PROV-001
entry:STARK-002 ──[tagged]──> tag:vault
entry:abc123 ──[supersedes]──> entry:def456 (archived)
```

Storing this in flat JSONL files and reconstructing it via text parsing
is working against the grain of the data.

---

## 3. Queries We Want But Can't Do

| Query | Today | With graph backend |
|-------|-------|--------------------|
| "Everything connected to Vault" | `kb search vault` (keyword match) | Traverse from `tag:vault` through all edges |
| "What areas are affected by VPN changes?" | Manual inspection | Traverse from `area:infra-networking` through `linked_areas` |
| "What decisions led to Stark architecture?" | `kb load stark-picking` and read | Follow `references` edges from decision entries |
| "What tags co-occur with ssl?" | Not possible | Tag co-occurrence query |
| "Show me the archived entry this replaced" | `kb load --zone archive` and match by eye | Follow `supersedes` edge |
| "Impact of changing entry X" | Not possible | Reverse traverse `referenced_by` edges |

---

## 4. Why Now

The knowledge base has grown to 34 areas with hundreds of entries across
multiple workspaces. Cross-area relationships exist in practice (entries
reference other areas, decisions cite earlier decisions) but are invisible
to the system. The Curator agent discovered this during the bulk curation
pass — consolidating entries across areas required manual cross-referencing
that a graph query could have automated.

### Beyond personal use

mykb is a personal KB today, but it is being designed to become a
**corporate knowledge base**. This means:

- **Multiple users** — humans and AI agents reading/writing concurrently
- **Multiple vf-agents instances** — Pi coding agents accessing shared
  knowledge across projects and teams
- **Access control** — not all users/agents should see all areas
- **Audit trail** — who changed what, when (compliance, debugging)
- **API access** — GraphQL endpoint for external tools and integrations
- **Concurrency** — SQLite single-writer lock already causes BUSY errors
  with parallel Curator execution; this only gets worse with more agents

SQLite cannot serve this trajectory. PostgreSQL via Gel provides ACID
transactions, concurrent access, row-level permissions, and a native
GraphQL API.

The existing `KnowledgeStore` and `WorkspaceStorage` interfaces were
designed to be pluggable. A graph backend is a new implementation of these
interfaces plus a new `GraphStore` interface for graph-specific queries.

---

## 5. Approach: Gel (PostgreSQL) as Primary Store

Research (see design doc) found:

- **EdgeDB is now Gel** (renamed Feb 2025). Graph-relational DB on PostgreSQL.
  Built-in GraphQL, TypeScript client, access policies, schema migrations.
- **Graphiti (Zep)** validates graph-based knowledge stores for multi-agent
  systems at scale.

The decided approach (see design doc iteration 3):

1. **Gel on PostgreSQL is the source of truth** — entries, relationships,
   workspaces, access control, and audit trail all live in Gel
2. **GraphQL API** — built-in, enables external tools and multiple
   vf-agents instances to query the KB concurrently
3. **JSONL becomes import/export** — `kb export` for git archival and
   portability, `kb import` for migration from v1
4. **Local SQLite cache** — offline fallback for read operations, refreshed
   via `kb sync`
5. **PostgreSQL FTS** — replaces SQLite FTS5 as the primary search engine

Deployment: `docker compose up` with a Gel container for personal use.
Managed Gel/PostgreSQL for corporate use.

---

## 6. Design Principles

Based on the v1 architecture, review of the initial design draft, and
the corporate KB trajectory:

1. **Gel (PostgreSQL) is the source of truth.** A corporate KB needs ACID
   transactions, concurrent access, access control, and audit trail. JSONL
   becomes the portable import/export format.

2. **Polymorphic types, not god objects.** Entry subtypes (Fact, Decision,
   Gotcha, Pattern, Link) should be modeled as separate types with shared
   base, not a wide table with nullable fields.

3. **Relationships need metadata.** When was it created? By whom? Explicit
   or auto-extracted? What confidence? Directional or bidirectional?

4. **Degraded mode is required.** The system must function (reads at least)
   when Gel is unavailable. Local SQLite cache as offline fallback.

5. **Search must not regress.** PostgreSQL FTS (`tsvector`) replaces SQLite
   FTS5 as primary. Local SQLite FTS5 as offline fallback.

6. **Multi-agent concurrency is a first-class concern.** Multiple vf-agents
   instances will read/write simultaneously. No single-writer bottlenecks.

7. **Graph traversal needs constraints.** Unbounded traversal on cyclic
   graphs is dangerous. Every query needs depth limits, edge-type filters,
   and cycle protection.

8. **Access control from day one.** Even in personal mode, model users and
   roles. Corporate mode activates them.

---

## 7. Next Step

Design document (`graph-backend-DESIGN.md`) is being iterated. Currently
at iteration 3 with all core design decisions resolved.
