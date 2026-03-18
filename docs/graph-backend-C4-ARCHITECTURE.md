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
