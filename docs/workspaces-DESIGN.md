# Workspaces — Design

## Problem

You have a knowledge base with many areas — networking, CI pipelines, secrets management, customer knowledge, VM provisioning. Each area accumulates facts over time. But when you sit down to work, you're not working on "networking in general" — you're working on a specific project: deploying the Stark picking dashboard, setting up disaster recovery, upgrading SonarQube.

A project touches multiple knowledge areas. The Stark picking dashboard needs facts from the `stark` area (customer knowledge), `infra-vm` (VM provisioning patterns), and its own project-specific knowledge (which VM was assigned, which Ansible playbooks were written, which CI pipeline was configured). Without a way to scope this, you either load everything (too much context, wasted tokens, noise) or load manually each session (friction, easy to forget).

A project also has state that knowledge areas don't have. It has a phase ("server-setup"), something actively being worked on ("M2 app installation"), blockers ("waiting for VPN routes"), and a next step ("IaC backport"). This state changes every session. It's not knowledge — it's progress tracking.

A project also has a journal — a session-by-session log of what happened. "Set up the Ansible repo. Applied base role to dev VM. Renamed the VM. CI pipeline green." This is temporal — it tells you where you left off, not what is true about the world.

And a project has links — the Jira ticket, the wiki page, the GitLab repos, the Terraform module. These are pointers to external systems that the AI needs when working on this project.

None of these belong in a knowledge area:
- **State** is not knowledge — it changes every session
- **Journal** is not knowledge — it's temporal progress notes
- **Links** are not knowledge — they're pointers (though mykb areas have links too)
- **Area scoping** is not knowledge — it's context management

But they're essential for productive AI sessions. Without them, every session starts with "what was I working on? which areas do I need? what's the Jira ticket?"

## What we learned from OSB v1

OSB v1 combined knowledge and workspaces in one system. The workspace BRAIN.md held both project-scoped facts AND orchestration metadata (state, journal, links). This caused problems:

1. **Knowledge was trapped in workspaces.** Facts discovered during the stark-picking project (VM IPs, SSH access, network paths) were stored in the workspace, not in reusable knowledge areas. When the project was archived, this knowledge was harder to find.

2. **Context management was crude.** `osb load stark-picking` loaded everything — all workspace facts + all linked area facts. No scoring, no filtering, no token budget. With large areas, this flooded the context.

3. **Workspaces did too much.** They were knowledge stores AND project trackers AND context managers. This coupling made the system hard to extend.

## Solution: Workspaces as thin metadata in mykb

A workspace is NOT a knowledge store. It is a small metadata file that:

1. **Points to mykb areas** — which areas are relevant to this work
2. **Tracks state** — phase, active, blocked, next
3. **Records a journal** — session-by-session progress notes
4. **Holds external links** — Jira tickets, wiki pages, repos

All project-scoped knowledge (facts, decisions, gotchas, patterns) lives in mykb areas — typically an area with the same name as the workspace (e.g., workspace `stark-picking` links to area `stark-picking` plus areas `stark` and `infra-vm`).

### Storage

```
~/.mykb/
├── areas/                    # knowledge (managed by mykb)
│   ├── stark-picking/
│   ├── stark/
│   └── infra-vm/
├── workspaces/               # orchestration (new)
│   ├── stark-picking.json
│   ├── dr.json
│   └── sonarqube-upgrade.json
├── manifest.json
└── kb.db
```

### Workspace file format

```json
{
  "id": "stark-picking",
  "name": "Stark Picking Dashboard",
  "state": {
    "phase": "server-setup",
    "active": "M2 app installation on TESTPDA-2026",
    "blocked": "none",
    "next": "IaC backport of Harbor NSG rule"
  },
  "areas": ["stark-picking", "stark", "infra-vm"],
  "links": {
    "jira": "STARK-653",
    "wiki": "https://wiki.example.com/Stark",
    "repos": [
      "stark/stark-picking-dashboard",
      "stark/stark-pda-deployment"
    ],
    "docs": []
  },
  "created": "2026-03-07",
  "updated": "2026-03-15"
}
```

### Journal

Journal entries are stored separately as a JSONL file per workspace:

```
~/.mykb/workspaces/stark-picking.journal.jsonl
```

Each line:
```json
{"date":"2026-03-09","text":"Dev VM complete, phase moved to server-setup. Blocker: Christian VPN+gateway routes."}
```

This keeps the workspace JSON small (state + links only) while the journal grows over time.

## Context management

When you start working on a workspace, mykb needs to load the right knowledge without flooding the context.

### How it works with mykb's three tiers

**Session start (`kb work start stark-picking`):**
1. Read workspace JSON — get state, links, linked areas
2. Add linked areas to Tier 2's sticky set — scorer will prioritize these
3. Inject workspace state as a system message: "You are working on: Stark Picking Dashboard. Phase: server-setup. Active: M2 app installation."
4. Inject recent journal entries (last 3)

**During the session:**
- Tier 2 scorer has the linked areas boosted — they score higher even without explicit signals
- As you work (read files, run commands), Tier 2 injects relevant facts from the linked areas
- You don't get all 90 facts from 3 areas — you get the top-scoring facts within the 2000 token budget
- Zone filtering: active zone facts score higher than established

**On demand:**
- `/kb stark` loads the full stark area if you need deeper context
- This is the same Tier 3 mechanism, unchanged

**Session end:**
- Auto-save workspace state
- Auto-append journal entry (if the AI wrote one)

### What you DON'T get at session start

- All facts from all linked areas (too much)
- Established zone facts (background reference, loaded on demand)
- Knowledge from unlinked areas (scorer handles these reactively)

### What you DO get at session start

- Workspace state (phase, active, blocked, next) — ~50 tokens
- Last 3 journal entries — ~200 tokens
- External links (Jira, repos, wiki) — ~100 tokens
- Tier 2 scorer pre-seeded with linked area IDs — automatic injection starts immediately

Total upfront cost: ~350 tokens. The rest comes via Tier 2 as you work.

## CLI commands

Added to the existing `kb` CLI:

| Command | Purpose |
|---------|---------|
| `kb work create <id> <name>` | Create a workspace, optionally link areas with `--areas a1,a2` |
| `kb work start <id>` | Set active workspace, pre-load context |
| `kb work stop` | Clear active workspace |
| `kb work state --phase/--active/--blocked/--next` | Update workspace state |
| `kb work journal "text"` | Append journal entry |
| `kb work journal --show [N]` | Show last N journal entries (default 5) |
| `kb work link <area>` | Link an area to active workspace |
| `kb work unlink <area>` | Unlink an area |
| `kb work list` | List all workspaces with state |
| `kb work archive <id>` | Archive a completed workspace |
| `kb work show [id]` | Show workspace details (default: active) |

## Pi extension integration

The Pi extension adds:
- On `session_start`: if an active workspace is set, inject state + journal + boost linked areas
- Registered tool `kb_work_state`: AI can update workspace state during a session
- Registered tool `kb_work_journal`: AI can append journal entries
- On `session_shutdown`: auto-save workspace, optionally auto-journal

## What this replaces from OSB

| OSB concept | mykb equivalent |
|-------------|----------------|
| `osb load <workspace>` | `kb work start <id>` + mykb Tier 2 auto-injection |
| `osb save <workspace>` | `kb save` (unchanged) |
| `osb journal <workspace> "text"` | `kb work journal "text"` |
| `osb set-state <workspace>` | `kb work state --phase "..."` |
| `osb detect` | Could map CWD → workspace via repo links (future) |
| `osb init workspace` | `kb work create` |
| `osb archive-workspace` | `kb work archive` |
| Workspace BRAIN.md knowledge section | mykb area with same name as workspace |
| Workspace linked areas | `workspace.areas` field in JSON |

## What this does NOT replace

- OSB container model (instances, sessions) — that's vfa
- OSB observability (server, telemetry) — separate concern
- OSB's Claude Code hooks — mykb uses Pi extension instead
- osbctl — instance management, not knowledge
