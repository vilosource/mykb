# Task Tracker — Early Design Notes

Status: Ideation (spitballing session 2026-03-18)

## Problem

When working on implementation plans, we go through: design docs + diagrams, then an implementation plan refined into phases and tasks. Today there is no structured way for an LLM agent to know what's been done, what's next, or to hand off work to another session or agent. Workspace journals capture narrative but aren't machine-parseable.

## Vision

A distributed task execution system for LLM agents, backed by Postgres, communicating via web RPC and events, tightly integrated with mykb for knowledge context.

The core idea: each task is an **agent work packet** — it contains enough context (description, acceptance criteria, kb areas, files, docs) that any LLM agent can pick it up cold and execute it.

## Core Concepts

| Concept | Description |
|---------|-------------|
| Initiative | A refined implementation plan with phases and tasks. Born from design/planning collaboration. |
| Phase | Ordered grouping within an initiative. Sequential execution. |
| Task | An agent-executable work packet. Full context for cold handoff. |
| Agent | An LLM worker (local or remote) that claims and executes tasks. |

## Hierarchy

```
Workspace (mykb context)
 └── Initiative(s)
      └── Phase(s)
           └── Task(s)
```

- A workspace can have multiple initiatives
- Initiatives are bound to one workspace (not shared/movable)
- Artifacts (design docs) exist at both workspace and initiative level
- Cross-initiative dependencies are informal (text notes, not enforced)

## Decided So Far

- **Separate system from mykb** — own tool (working name `tt`?), own storage. Not `kb initiative`.
- **Postgres** as central store — multiple agents on different machines need access.
- **Web RPC + events** for all communication — localhost or public IP makes no difference to the system. Location-agnostic from day one.
- **Pull + push task distribution** — agents claim tasks from a pool by default, but tasks can be pinned to a specific agent.
- **Task statuses**: todo, doing, blocked, deferred, cancelled, done (full lifecycle).
- **Result = commit + status update** — the code is the deliverable. Agent pushes a commit or MR and marks the task done.
- **KB area linking** — tasks reference mykb knowledge areas so agents can `kb load` relevant context.
- **Tasks as agent work packets** — each task carries: title, description, acceptance criteria, linked areas, relevant files, related docs, blockers, notes.

## Task Shape (Draft)

```
Task:
  id: nanoid
  title: "Filter archived entries from kb load output"
  status: todo | doing | blocked | deferred | cancelled | done
  phase: "phase-1-zone-filtering"
  initiative: "zone-filter-fix"

  # Agent context
  description: "kb load and scorer.ts don't filter by zone..."
  acceptance_criteria: ["archived entries excluded from kb load", "tests pass"]
  areas: ["mykb"]
  files: ["src/core/db.ts", "src/extension/hooks/scorer.ts"]
  docs: ["zone-filter-BUGFIX.md"]

  # Tracking
  blockers: []
  notes: []
  commits: []
```

## Open Questions

- **Intake**: How does a plan document become a structured initiative? Likely a dedicated command/process.
- **Hooks/automation**: How do status updates get triggered? Explicit commands, hooks, or automatic detection?
- **Agent capabilities/matching**: How to route the right task to the right agent type.
- **Concurrency**: What happens when two agents try to claim the same task.
- **Naming**: `tt`? Something else?
- **Nesting depth**: Phase > Task is confirmed. Do tasks need subtasks?
- **Jira integration**: At initiative level? Optional link? TBD.
- **Postgres hosting**: Local for now, production hosting decided later.

## Not Decided

- API surface / RPC methods
- Event types
- Postgres schema
- Agent registration and identity
- Authentication / authorization for remote agents
