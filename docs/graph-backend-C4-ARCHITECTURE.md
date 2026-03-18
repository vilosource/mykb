# mykb v2 Graph Backend - C4 Architecture Diagrams

This document contains the C4 architecture for the mykb v2 knowledge management system.

## C1 - System Context Diagram

Shows how mykb fits into the broader ecosystem — users, agents, and external systems.

```mermaid
graph TB
    subgraph actors [" "]
        direction LR
        human["👤 Human Operator<br/><i>Engineers & developers<br/>using kb CLI from terminal</i>"]
        agents["🤖 AI Coding Agents<br/><i>vf-agents/Pi containers<br/>multiple concurrent instances</i>"]
        claude["🧠 Claude Code Agent<br/><i>AI coding assistant<br/>using kb CLI on host</i>"]
        curator["⚙️ Curator Agent<br/><i>Automated knowledge<br/>curation agent</i>"]
    end

    mykb(["📚 mykb Knowledge Management System<br/><i>Graph-relational knowledge base<br/>Gel on PostgreSQL, CLI interface</i>"])

    subgraph external [" "]
        direction LR
        jira["🎫 Jira<br/><i>Issue tracking</i>"]
        gitlab["🦊 GitLab<br/><i>Source code repos</i>"]
        wiki["📖 Wiki<br/><i>Documentation</i>"]
        github["🐙 GitHub<br/><i>JSONL export archive</i>"]
    end

    human -->|"kb CLI commands"| mykb
    agents -->|"kb CLI in containers"| mykb
    claude -->|"kb CLI on host"| mykb
    curator -->|"Automated curation"| mykb

    mykb -.->|"Read reference"| jira
    mykb -.->|"Read reference"| gitlab
    mykb -.->|"Read reference"| wiki
    mykb -->|"JSONL export<br/>git push"| github

    style mykb fill:#1a5276,stroke:#2e86c1,color:#fff,stroke-width:3px
    style human fill:#1c2833,stroke:#5dade2,color:#fff
    style agents fill:#1c2833,stroke:#5dade2,color:#fff
    style claude fill:#1c2833,stroke:#5dade2,color:#fff
    style curator fill:#1c2833,stroke:#5dade2,color:#fff
    style jira fill:#2c3e50,stroke:#7f8c8d,color:#fff
    style gitlab fill:#2c3e50,stroke:#7f8c8d,color:#fff
    style wiki fill:#2c3e50,stroke:#7f8c8d,color:#fff
    style github fill:#2c3e50,stroke:#7f8c8d,color:#fff
    style actors fill:transparent,stroke:none
    style external fill:transparent,stroke:none

    linkStyle 0,1,2,3 stroke:#5dade2,stroke-width:2px
    linkStyle 4,5,6 stroke:#7f8c8d,stroke-width:1px,stroke-dasharray:5
    linkStyle 7 stroke:#27ae60,stroke-width:2px
```

## C2 - Container Diagram

The major containers within mykb and how they interact. Gel (PostgreSQL) is the source of truth. SQLite provides offline read fallback.

```mermaid
graph TB
    users["👤🤖🧠 Users & Agents<br/><i>Humans, AI agents, curator</i>"]
    ext["🔗 External Systems<br/><i>Jira, GitLab, Wiki</i>"]

    subgraph system ["mykb Knowledge Management System"]
        direction TB

        cli["⌨️ kb CLI<br/><i>TypeScript</i><br/>Command-line interface<br/>for all knowledge operations"]

        subgraph storage ["Data Stores"]
            direction LR
            gel[("🗄️ Gel Database<br/><i>PostgreSQL + EdgeQL</i><br/>Source of truth<br/>Graph-relational store<br/>Access policies + audit")]
            graphql["🌐 GraphQL API<br/><i>Built-in to Gel</i><br/>Auto-generated API<br/>for external tools"]
            sqlite[("💾 SQLite Cache<br/><i>SQLite + FTS5</i><br/>Per-client read-only<br/>Offline fallback")]
        end

        jsonl["📄 JSONL Export<br/><i>File system</i><br/>Portable format<br/>Migration & archival"]
    end

    github["🐙 GitHub<br/><i>Export archive</i>"]

    users -->|"kb commands"| cli
    cli -->|"Reads / Writes<br/>(primary path)"| gel
    cli -.->|"Reads only<br/>(fallback when Gel down)"| sqlite
    cli -->|"Export / Import"| jsonl
    gel --- graphql
    ext -->|"Queries"| graphql
    sqlite -.->|"kb sync"| gel
    jsonl -->|"git push"| github

    style users fill:#1c2833,stroke:#5dade2,color:#fff
    style ext fill:#2c3e50,stroke:#7f8c8d,color:#fff
    style cli fill:#1a5276,stroke:#2e86c1,color:#fff,stroke-width:2px
    style gel fill:#0e6251,stroke:#1abc9c,color:#fff,stroke-width:3px
    style graphql fill:#0e6251,stroke:#1abc9c,color:#fff
    style sqlite fill:#4a235a,stroke:#8e44ad,color:#fff
    style jsonl fill:#7b241c,stroke:#e74c3c,color:#fff
    style github fill:#2c3e50,stroke:#7f8c8d,color:#fff
    style system fill:#1c283308,stroke:#5dade2,color:#fff,stroke-width:2px
    style storage fill:#1c283308,stroke:#7f8c8d,color:#fff,stroke-dasharray:5

    linkStyle 0 stroke:#5dade2,stroke-width:2px
    linkStyle 1 stroke:#1abc9c,stroke-width:3px
    linkStyle 2 stroke:#8e44ad,stroke-width:1px,stroke-dasharray:5
    linkStyle 3 stroke:#e74c3c,stroke-width:2px
    linkStyle 4 stroke:#1abc9c,stroke-width:1px
    linkStyle 5 stroke:#7f8c8d,stroke-width:1px
    linkStyle 6 stroke:#8e44ad,stroke-width:1px,stroke-dasharray:5
    linkStyle 7 stroke:#27ae60,stroke-width:2px
```

## C3 - Component Diagram (kb CLI)

Internal structure of the kb CLI. Shows the store abstractions, interface boundaries, audit logging, and relationship extraction.

```mermaid
graph TB
    user["👤🤖 User / Agent"]

    subgraph cli ["kb CLI Container"]
        direction TB

        commands["⌨️ CLI Commands<br/><i>Commander.js</i><br/>kb add, load, search,<br/>traverse, relate, export"]

        client["🔀 KbClient<br/><i>Router / Orchestrator</i><br/>Checks Gel availability<br/>Routes to correct store"]

        subgraph write_path ["Write Path (Gel required)"]
            direction TB
            audited["📋 AuditedStore<br/><i>Decorator Pattern</i><br/>Wraps GelStore<br/>Creates ChangeLog entries<br/>Agent + user attribution"]
            gel_store["🗄️ GelStore<br/><i>Primary Implementation</i><br/>CRUD + graph operations<br/>EdgeQL client"]
            extractor["🔍 RelationshipExtractor<br/><i>Text Analysis</i><br/>Extracts implicit refs<br/>3-tier confidence scoring"]
        end

        subgraph read_fallback ["Read Fallback"]
            sqlite_store["💾 SqliteCacheStore<br/><i>KnowledgeReader only</i><br/>Entries + FTS5 index<br/>Cannot receive writes"]
        end

        subgraph interfaces ["Interfaces"]
            direction LR
            reader["📖 KnowledgeReader<br/><i>loadArea, search<br/>matchAreas</i>"]
            writer["✏️ KnowledgeWriter<br/><i>addFact, addDecision<br/>updateEntry, deleteEntry</i>"]
            grapher["🕸️ GraphQuerier<br/><i>traverse, related<br/>impact, relate</i>"]
        end
    end

    gel_db[("🗄️ Gel Database<br/><i>PostgreSQL</i>")]
    sqlite_db[("💾 SQLite Cache<br/><i>Local file</i>")]

    user -->|"kb commands"| commands
    commands --> client

    client -->|"Writes + graph ops"| audited
    client -.->|"Reads (fallback)"| sqlite_store

    audited -->|"Delegates + logs"| gel_store
    gel_store -->|"On write"| extractor
    extractor -->|"Creates edges"| gel_store

    gel_store -->|"EdgeQL"| gel_db
    sqlite_store -->|"SQL"| sqlite_db

    gel_store -.-|"implements"| reader
    gel_store -.-|"implements"| writer
    gel_store -.-|"implements"| grapher
    sqlite_store -.-|"implements"| reader

    style user fill:#1c2833,stroke:#5dade2,color:#fff
    style commands fill:#1a5276,stroke:#2e86c1,color:#fff
    style client fill:#1a5276,stroke:#2e86c1,color:#fff,stroke-width:2px
    style audited fill:#7d6608,stroke:#f1c40f,color:#fff,stroke-width:2px
    style gel_store fill:#0e6251,stroke:#1abc9c,color:#fff,stroke-width:2px
    style extractor fill:#0e6251,stroke:#1abc9c,color:#fff
    style sqlite_store fill:#4a235a,stroke:#8e44ad,color:#fff
    style reader fill:#1c2833,stroke:#5dade2,color:#fff
    style writer fill:#1c2833,stroke:#27ae60,color:#fff
    style grapher fill:#1c2833,stroke:#e67e22,color:#fff
    style gel_db fill:#0e6251,stroke:#1abc9c,color:#fff
    style sqlite_db fill:#4a235a,stroke:#8e44ad,color:#fff
    style cli fill:#1c283308,stroke:#5dade2,color:#fff,stroke-width:2px
    style write_path fill:#0e625108,stroke:#1abc9c,color:#fff,stroke-dasharray:5
    style read_fallback fill:#4a235a08,stroke:#8e44ad,color:#fff,stroke-dasharray:5
    style interfaces fill:#1c283308,stroke:#7f8c8d,color:#fff,stroke-dasharray:5

    linkStyle 0,1 stroke:#5dade2,stroke-width:2px
    linkStyle 2 stroke:#f1c40f,stroke-width:2px
    linkStyle 3 stroke:#8e44ad,stroke-width:1px,stroke-dasharray:5
    linkStyle 4 stroke:#1abc9c,stroke-width:2px
    linkStyle 5,6 stroke:#1abc9c,stroke-width:1px
    linkStyle 7 stroke:#1abc9c,stroke-width:2px
    linkStyle 8 stroke:#8e44ad,stroke-width:1px
    linkStyle 9,10,11,12 stroke:#7f8c8d,stroke-width:1px,stroke-dasharray:3
```

## C4 - Code Level Diagrams

### C4.1 - Interfaces and Implementations

The type system enforces which stores can do what. GelStore implements all three interfaces. SqliteCacheStore implements only KnowledgeReader. AuditedStore wraps GelStore for write and graph operations.

```mermaid
classDiagram
    direction TB

    class KnowledgeReader {
        <<interface>>
        +loadArea(area, filter?) KnowledgeEntry[]
        +search(query) KnowledgeEntry[]
        +matchAreas(text) AreaScore[]
        +getArea(area) AreaMetadata
        +listAreas() AreaMetadata[]
    }

    class KnowledgeWriter {
        <<interface>>
        +addFact(area, text, options?) string
        +addDecision(area, text, options?) string
        +addGotcha(area, text, options?) string
        +addPattern(area, text, options?) string
        +addLink(area, text, url, options?) string
        +updateEntry(area, id, updates) void
        +deleteEntry(area, id) void
        +verifyEntry(area, id) void
        +promoteEntry(area, id) void
        +archiveEntry(area, id) void
        +initArea(id, name, summary?) void
    }

    class GraphQuerier {
        <<interface>>
        +relate(fromId, toId, type) void
        +unrelate(fromId, toId, type) void
        +traverse(id, options?) TraversalResult
        +related(area, options?) TraversalResult
        +impact(id) TraversalResult
        +tagCoOccurrence(tag) TagCount[]
    }

    class Portable {
        <<interface>>
        +exportJsonl(path) void
        +importJsonl(path) void
    }

    class HealthCheckable {
        <<interface>>
        +isAvailable() Promise~boolean~
    }

    class GelStore {
        -client: GelClient
        -connectionString: string
        +loadArea(area, filter?) KnowledgeEntry[]
        +search(query) KnowledgeEntry[]
        +addFact(area, text, options?) string
        +traverse(id, options?) TraversalResult
        +exportJsonl(path) void
        +importJsonl(path) void
        +isAvailable() Promise~boolean~
    }

    class AuditedStore {
        -store: GelStore
        -getCurrentUser() User
        -getAgentId() string
        +addFact(area, text, options?) string
        +updateEntry(area, id, updates) void
        +relate(fromId, toId, type) void
        +traverse(id, options?) TraversalResult
        -logChange(action, targetType, targetId, prev, next) void
    }

    class SqliteCacheStore {
        -dbPath: string
        -db: Database
        +loadArea(area, filter?) KnowledgeEntry[]
        +search(query) KnowledgeEntry[]
        +matchAreas(text) AreaScore[]
        +syncFrom(source: KnowledgeReader) Promise~void~
    }

    class KbClient {
        -gel: GelStore
        -cache: SqliteCacheStore
        -writer: AuditedStore
        +read() KnowledgeReader
        +write() KnowledgeWriter
        +graph() GraphQuerier
    }

    KnowledgeReader <|.. GelStore
    KnowledgeWriter <|.. GelStore
    GraphQuerier <|.. GelStore
    Portable <|.. GelStore
    HealthCheckable <|.. GelStore

    KnowledgeReader <|.. SqliteCacheStore

    KnowledgeWriter <|.. AuditedStore
    GraphQuerier <|.. AuditedStore
    AuditedStore --> GelStore : wraps

    KbClient --> GelStore
    KbClient --> SqliteCacheStore
    KbClient --> AuditedStore

    style KnowledgeReader fill:#1c2833,stroke:#5dade2,color:#fff
    style KnowledgeWriter fill:#1c2833,stroke:#27ae60,color:#fff
    style GraphQuerier fill:#1c2833,stroke:#e67e22,color:#fff
    style Portable fill:#1c2833,stroke:#7f8c8d,color:#fff
    style HealthCheckable fill:#1c2833,stroke:#7f8c8d,color:#fff
    style GelStore fill:#0e6251,stroke:#1abc9c,color:#fff
    style AuditedStore fill:#7d6608,stroke:#f1c40f,color:#fff
    style SqliteCacheStore fill:#4a235a,stroke:#8e44ad,color:#fff
    style KbClient fill:#1a5276,stroke:#2e86c1,color:#fff
```

### C4.2 - Gel Schema (Entity Relationships)

The Gel type hierarchy with polymorphic entries, graph relationships, and access control.

```mermaid
classDiagram
    direction TB

    class Timestamped {
        <<abstract>>
        +created: datetime
        +updated: datetime
    }

    class User {
        +email: str
        +name: str
        +roles: Role[]
    }

    class Role {
        +name: str
        +areas: Area[]
        +can_read: bool
        +can_write: bool
        +can_admin: bool
    }

    class Area {
        +slug: str
        +name: str
        +summary: str
        +owner: str
        +tags: Tag[]
        +linked_areas: Area[]
        +entries: Entry[] ← computed
        +linked_from: Area[] ← computed
    }

    class Entry {
        <<abstract>>
        +entry_id: str
        +area: Area
        +text: str
        +zone: ZoneType
        +prov_status: ProvenanceStatus
        +prov_date: datetime
        +prov_source: str
        +tags: Tag[]
        +references: Entry[] → with confidence
        +supersedes: Entry[]
        +referenced_by: Entry[] ← computed
        +created_by: User
        +updated_by: User
    }

    class Fact {
    }

    class Decision {
        +why: str
        +rejected: str
        +context: str
    }

    class Gotcha {
        +failed: bool
        +resolution: ResolutionStatus
    }

    class Pattern {
    }

    class Link {
        +url: str
    }

    class Tag {
        +name: str
        +category: str
        +description: str
        +entries: Entry[] ← computed
        +areas: Area[] ← computed
    }

    class Workspace {
        +slug: str
        +name: str
        +phase: str
        +active_task: str
        +blocked: str
        +next_task: str
        +areas: Area[]
        +jira: str
        +wiki: str
        +repos: str[]
        +journal: JournalEntry[] ← computed
    }

    class JournalEntry {
        +workspace: Workspace
        +date: local_date
        +text: str
    }

    class ChangeLog {
        +action: str
        +target_type: str
        +target_id: str
        +user: User
        +agent: str
        +previous_value: json
        +new_value: json
    }

    Timestamped <|-- User
    Timestamped <|-- Area
    Timestamped <|-- Entry
    Timestamped <|-- Tag
    Timestamped <|-- Workspace
    Timestamped <|-- JournalEntry
    Timestamped <|-- ChangeLog

    Entry <|-- Fact
    Entry <|-- Decision
    Entry <|-- Gotcha
    Entry <|-- Pattern
    Entry <|-- Link

    Entry "*" --> "1" Area : belongs to
    Entry "*" --> "*" Tag : tagged
    Entry "*" --> "*" Entry : references
    Entry "*" --> "*" Entry : supersedes
    Entry "*" --> "0..1" User : created_by
    Area "*" --> "*" Tag : tagged
    Area "*" --> "*" Area : linked_areas
    Workspace "*" --> "*" Area : has areas
    JournalEntry "*" --> "1" Workspace : belongs to
    User "*" --> "*" Role : has roles
    Role "*" --> "*" Area : grants access
    ChangeLog "*" --> "0..1" User : changed by

    style Timestamped fill:#1c2833,stroke:#7f8c8d,color:#fff
    style User fill:#7b241c,stroke:#e74c3c,color:#fff
    style Role fill:#7b241c,stroke:#e74c3c,color:#fff
    style Area fill:#0e6251,stroke:#1abc9c,color:#fff
    style Entry fill:#1a5276,stroke:#2e86c1,color:#fff
    style Fact fill:#1a5276,stroke:#5dade2,color:#fff
    style Decision fill:#1a5276,stroke:#5dade2,color:#fff
    style Gotcha fill:#1a5276,stroke:#5dade2,color:#fff
    style Pattern fill:#1a5276,stroke:#5dade2,color:#fff
    style Link fill:#1a5276,stroke:#5dade2,color:#fff
    style Tag fill:#7d6608,stroke:#f1c40f,color:#fff
    style Workspace fill:#4a235a,stroke:#8e44ad,color:#fff
    style JournalEntry fill:#4a235a,stroke:#8e44ad,color:#fff
    style ChangeLog fill:#1c2833,stroke:#e67e22,color:#fff
```

### C4.3 - RelationshipExtractor

The three-tier extraction pipeline that analyzes entry text and creates graph edges with confidence scores.

```mermaid
graph LR
    entry["✏️ New Entry<br/><i>text with implicit refs</i>"]

    subgraph extractor ["RelationshipExtractor"]
        direction TB
        parse["Parse Text<br/><i>Regex patterns</i>"]

        subgraph tiers ["Three-Tier Confidence"]
            direction LR
            high["🟢 High 0.95<br/><i>area:known-id</i><br/>Known area reference"]
            medium["🟡 Medium 0.7<br/><i>UPPER-NNN</i><br/>Known entry ID match"]
            low["🔴 Low 0.0<br/><i>UPPER-NNN</i><br/>Unknown — ignored"]
        end

        create["Create Edges<br/><i>via GelStore.relate()</i>"]
    end

    gel[("🗄️ Gel<br/>Graph edges")]

    entry --> parse
    parse --> high
    parse --> medium
    parse --> low
    high --> create
    medium --> create
    create --> gel

    style entry fill:#1a5276,stroke:#2e86c1,color:#fff
    style parse fill:#0e6251,stroke:#1abc9c,color:#fff
    style high fill:#0e6251,stroke:#27ae60,color:#fff
    style medium fill:#7d6608,stroke:#f1c40f,color:#fff
    style low fill:#7b241c,stroke:#e74c3c,color:#fff
    style create fill:#0e6251,stroke:#1abc9c,color:#fff
    style gel fill:#0e6251,stroke:#1abc9c,color:#fff
    style extractor fill:#1c283308,stroke:#1abc9c,color:#fff,stroke-dasharray:5
    style tiers fill:#1c283308,stroke:#7f8c8d,color:#fff,stroke-dasharray:5

    linkStyle 0,1,2,3,4,5,6 stroke:#1abc9c,stroke-width:2px
```

### C4.4 - KbClient Routing Logic

How KbClient decides where to route read and write operations based on Gel availability.

```mermaid
graph TD
    cmd["⌨️ CLI Command"]

    cmd --> is_write{{"Write or<br/>graph mutation?"}}

    is_write -->|Yes| gel_up_w{{"Gel available?"}}
    gel_up_w -->|Yes| audited["📋 AuditedStore<br/>→ GelStore + ChangeLog"]
    gel_up_w -->|No| fail["❌ Error<br/><i>Writes require Gel</i>"]

    is_write -->|No| is_graph{{"Graph query?<br/><i>traverse, related,<br/>impact</i>"}}

    is_graph -->|Yes| gel_up_g{{"Gel available?"}}
    gel_up_g -->|Yes| gel_graph["🕸️ GelStore<br/>Graph query"]
    gel_up_g -->|No| fail_g["❌ Error<br/><i>Graph queries require Gel</i>"]

    is_graph -->|No| gel_up_r{{"Gel available?"}}
    gel_up_r -->|Yes| gel_read["🗄️ GelStore<br/>Read from Gel"]
    gel_up_r -->|No| cache["💾 SqliteCacheStore<br/><i>⚠️ May be stale</i>"]

    style cmd fill:#1a5276,stroke:#2e86c1,color:#fff
    style is_write fill:#1c2833,stroke:#5dade2,color:#fff
    style is_graph fill:#1c2833,stroke:#5dade2,color:#fff
    style gel_up_w fill:#1c2833,stroke:#1abc9c,color:#fff
    style gel_up_g fill:#1c2833,stroke:#1abc9c,color:#fff
    style gel_up_r fill:#1c2833,stroke:#1abc9c,color:#fff
    style audited fill:#7d6608,stroke:#f1c40f,color:#fff
    style gel_graph fill:#0e6251,stroke:#1abc9c,color:#fff
    style gel_read fill:#0e6251,stroke:#1abc9c,color:#fff
    style cache fill:#4a235a,stroke:#8e44ad,color:#fff
    style fail fill:#7b241c,stroke:#e74c3c,color:#fff
    style fail_g fill:#7b241c,stroke:#e74c3c,color:#fff

    linkStyle 0,3,6 stroke:#5dade2,stroke-width:2px
    linkStyle 1,4,7 stroke:#1abc9c,stroke-width:2px
    linkStyle 2 stroke:#f1c40f,stroke-width:2px
    linkStyle 5 stroke:#1abc9c,stroke-width:2px
    linkStyle 8 stroke:#1abc9c,stroke-width:2px
    linkStyle 9 stroke:#8e44ad,stroke-width:2px,stroke-dasharray:5
    linkStyle 10,11 stroke:#e74c3c,stroke-width:2px
```

---

## Architecture Notes

### Data Flow Examples

**Write (kb add fact):**
CLI Command → KbClient.write() → AuditedStore.addFact() → GelStore.addFact() + ChangeLog → RelationshipExtractor → graph edges

**Read (Gel available):**
CLI Command → KbClient.read() → GelStore.loadArea() → Gel Database

**Read (Gel down):**
CLI Command → KbClient.read() → Gel unavailable → SqliteCacheStore.loadArea() → SQLite Cache (staleness warning)

### Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Source of truth | Gel (PostgreSQL) | Corporate KB needs ACID, concurrency, access control |
| Offline reads | SQLite cache | Degraded mode with staleness warning |
| Offline writes | Fail with error | No WAL — edge case doesn't justify distributed systems complexity |
| Audit trail | Decorator pattern | AuditedStore wraps GelStore, cannot be bypassed |
| Entry types | Polymorphic | Fact, Decision, Gotcha, Pattern, Link as separate Gel types |
| Interface split | Reader / Writer / GraphQuerier | Type system prevents accidental writes to cache |
