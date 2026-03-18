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

The existing `KnowledgeStore` and `WorkspaceStorage` interfaces were
designed to be pluggable. A graph backend is a new implementation of these
interfaces plus a new `GraphStore` interface for graph-specific queries.

---

## 5. Candidate: EdgeDB

EdgeDB is a graph-relational database built on PostgreSQL with:
- First-class relationship links (not join tables)
- Schema DSL that maps to the mykb domain model
- Built-in GraphQL endpoint
- Native TypeScript client with type generation
- PostgreSQL-backed (battle-tested storage)

Alternative options considered:

| Option | Verdict | Reasoning |
|--------|---------|-----------|
| **Neo4j** | Possible | Most mature graph DB; has embedded mode and Bolt protocol for TypeScript. Heavy JVM dependency. Needs benchmarking at mykb scale. |
| **SurrealDB** | Possible | Document + graph in one. Younger project, API has stabilized recently. |
| **SQLite + recursive CTEs** | Insufficient | Already have it. Relationship queries get ugly fast, no first-class graph semantics. |
| **Plain GraphQL over JSONL** | Insufficient | Structured queries but no relationship storage. |
| **EdgeDB** | Preferred | Best balance of schema rigor, graph capabilities, TypeScript integration, and PostgreSQL reliability. |

The choice is not final. A design document will evaluate the trade-offs
in detail, including benchmarks and a proof-of-concept.

---

## 6. Design Principles

Based on the v1 architecture and the review of the initial design draft:

1. **JSONL source-of-truth question must be resolved first.** Relationships
   don't fit naturally in JSONL. The design must decide: does JSONL remain
   source of truth (with relationship loss on rebuild), or does the graph
   DB become the source of truth (with JSONL as export format)?

2. **Polymorphic types, not god objects.** Entry subtypes (Fact, Decision,
   Gotcha, Pattern, Link) should be modeled as separate types with shared
   base, not a wide table with nullable fields.

3. **Relationships need metadata.** When was it created? By whom? Explicit
   or auto-extracted? What confidence? Directional or bidirectional?

4. **Degraded mode is required.** The system must function when the graph
   DB is unavailable. Define what works and what doesn't.

5. **Search must not regress.** SQLite FTS5 is fast and effective. The graph
   backend must either match its full-text search capability or coexist
   alongside it.

6. **Dual-write consistency is hard.** Don't pretend it's simple. Define
   the consistency model explicitly.

7. **Graph traversal needs constraints.** Unbounded traversal on cyclic
   graphs is dangerous. Every query needs depth limits, edge-type filters,
   and cycle protection.

---

## 7. Next Step

Create a design document (`graph-backend-DESIGN.md`) that addresses the
principles above. Iterate until satisfied before any implementation begins.
