# Development Methodology Guide

A generic, project-agnostic methodology for planning, implementing, and testing software and infrastructure work. Extracted from real project experience (mykb v0.1.0, Stark PDA deployment, infrastructure roles) and battle-tested across TypeScript, Ansible, Terraform, and Docker projects.

This guide is the "how we work" reference. It applies to any project type.

---

## 1. Principles

### 1.1 Design First

Write design documents before code. Review them before implementing. Issues found in design are 10x cheaper than issues found in implementation.

**Process:**
1. Write a design document covering scope, architecture, interfaces, and data flow
2. Review pass 1: Does it solve the right problem?
3. Review pass 2: Are the interfaces clean? Are responsibilities separated?
4. Review pass 3: What can go wrong? What are the unknowns?
5. Only after review passes: begin implementation

**Artifacts:** Design document, known unknowns list, spike experiments list.

### 1.2 Spike Before You Build

When the design contains unknowns or unproven assumptions, run small experiments (spikes) to validate them before committing to a full implementation.

**When to spike:**
- Using a technology or tool for the first time
- Integrating with an external system whose behavior is uncertain
- Architectural decisions where failure would require significant rework
- Deployment paths that haven't been tested end-to-end

**Spike rules:**
- Time-boxed (hours, not days)
- Disposable code — spikes are experiments, not production code
- Document the finding, not the code
- Always include a **deployment spike** that tests the full path from source to running in the target environment

**What a spike proves:**
- "This approach works" or "This approach doesn't work — here's why"
- Exact configuration/syntax/API needed (copy this into real implementation)

### 1.3 Bottom-Up Implementation

Build in dependency order. Each phase produces something testable and demonstrable. No phase depends on work from a later phase.

```
Types/Interfaces → Core Logic → Integration Layer → User Interface → Deployment
```

This applies universally:
- **TypeScript:** types → store → database → facade → CLI → extension
- **Ansible:** defaults/vars → templates → tasks → handlers → role integration → playbook
- **Terraform:** variables → modules → resources → outputs → root module
- **Docker:** base image → dependencies → configuration → entrypoint → compose

### 1.4 Test-Driven Development

Every feature starts with a verification of the desired behavior.

**The cycle:**
1. **RED** — Define what "working" looks like. Write a test, a verification step, or a check command. Run it. Confirm it fails or shows the current (wrong) state.
2. **GREEN** — Write the minimum to make it pass. No more.
3. **REFACTOR** — Clean up while tests still pass. No new behavior.

**Rules:**
- No implementation without a failing test/check driving it
- One commit per step: `test:` (RED), `feat:` (GREEN), `refactor:` (optional)
- Tests describe behavior, not implementation details
- Table-driven tests for functions with multiple input/output cases

**Adapting TDD to different project types:**

| Project Type | RED (Define Expected) | GREEN (Implement) | REFACTOR |
|---|---|---|---|
| Application code | Unit test that fails | Write code to pass | Simplify |
| Ansible role | `--check` shows pending changes, or molecule verify fails | Write tasks to converge | Simplify tasks, extract variables |
| Terraform | `plan` shows resources to create | `apply` creates them | Refactor modules, extract variables |
| Docker image | Container fails to start or health check fails | Fix Dockerfile/config | Reduce layers, optimize size |
| CI pipeline | Pipeline fails at expected stage | Fix pipeline config | Simplify stages, extract templates |

### 1.5 SOLID Principles

These principles apply beyond object-oriented code. They're about separation of concerns and clean interfaces.

| Principle | Generic Application |
|---|---|
| **Single Responsibility** | Every file, role, module, or template does one thing. If you can't describe it in one sentence without "and", split it. |
| **Open/Closed** | Extensible without modification. New behaviors via new files/variables, not editing existing ones. |
| **Liskov Substitution** | Implementations are swappable. A mock, a test double, or an alternative can replace any component without breaking callers. |
| **Interface Segregation** | Consumers depend only on what they use. Don't force a playbook to know about variables it doesn't need. |
| **Dependency Inversion** | Depend on abstractions. Playbooks depend on role interfaces (variables), not on role internals (task file structure). |

### 1.6 Commit Discipline

One logical change per commit. Each commit is independently understandable and revertable.

**Conventional commit prefixes:**
- `test:` — test/verification code (RED step)
- `feat:` — implementation (GREEN step)
- `refactor:` — restructuring without behavior change
- `fix:` — bug fix
- `docs:` — documentation
- `chore:` — build, tooling, dependencies, CI

**TDD commit sequence:**
```
test: add failing check for openldap container health
feat: implement openldap docker-compose template
refactor: extract LDIF template into separate file
```

**Rules:**
- No AI attribution in commits
- No emojis in commit messages
- Professional, descriptive messages

---

## 2. Implementation Plan Structure

Every non-trivial piece of work gets an implementation plan before coding begins. The plan follows this structure.

### 2.1 Header

```markdown
# <Project> Implementation Plan

Parent: [link to design doc or ticket]
Manifesto: [link to this guide]
```

### 2.2 Approach

State the implementation order (bottom-up, top-down, or hybrid) with rationale. Identify the dependency graph between phases.

### 2.3 Testing Layers

Define the testing layers for this specific project. Every project has at least two layers:

| Layer | What It Tests | How | When |
|---|---|---|---|
| **Verification** | Individual components work correctly in isolation | Automated tests, lint, syntax checks, `--check` mode | Every commit |
| **Integration** | Components work together, end-to-end path functions | Deploy to test environment, run acceptance checks | Every phase completion |
| **Acceptance** | The user/consumer experience works as intended | Manual or scripted end-to-end scenarios | Milestone completion |

**Project-type examples:**

| Project Type | Verification | Integration | Acceptance |
|---|---|---|---|
| Application | Unit tests (vitest, pytest, go test) | CLI integration tests, API tests | User scenario walkthroughs |
| Ansible role | `ansible-lint`, `--check --diff`, molecule converge | Deploy to dev VM, verify services | Login/connect/use the service |
| Terraform | `terraform validate`, `plan` review | `apply` to dev, verify resources exist | Connect to infrastructure, verify routing |
| Docker image | `docker build` succeeds, hadolint | `docker compose up`, container healthy | Application inside container works end-to-end |
| CI pipeline | YAML lint, dry-run | Push to feature branch, pipeline runs | Artifact produced, deployed correctly |

### 2.4 Phase Gates

Mandatory checklist between every phase. No moving forward without all boxes checked.

**Standard gate:**
- [ ] All verification checks pass
- [ ] Integration test passes (if applicable to this phase)
- [ ] No regressions — previously working things still work
- [ ] Changes committed with proper TDD commit sequence
- [ ] No hardcoded secrets, credentials, or environment-specific values

**Extended gate (for phases that complete a milestone):**
- [ ] Acceptance test passes
- [ ] Documentation updated
- [ ] Consumer-facing interfaces are stable (breaking changes noted)

### 2.5 Spike Plan

List unknowns that need spike experiments before implementation begins. Each spike has:
- **Question:** What are we trying to learn?
- **Method:** How will we test it? (manual docker run, SSH to VM, small script)
- **Success criteria:** What does "it works" look like?
- **Time box:** Maximum time before we stop and reassess

Always include a **deployment spike** that tests the full path from source to running in the target environment.

### 2.6 Phases

Each phase must have ALL of these sections:

```markdown
## Phase N: <Name>

**Goal:** One sentence.

**Depends on:** Phase X, Y

**Design focus:** Which principles apply and how (map to specific modules/files).

**Development process:**
1. Step with TDD sequence (RED → GREEN → REFACTOR)
2. Commit message for each step
3. Table-driven tests where applicable

**Deliverables:** Files, templates, configurations produced.

**Verification:** Specific test cases with expected behavior.

**Integration check:** How to verify this phase works with previous phases.
```

### 2.7 Milestones

Group phases into deliverable milestones. Each milestone is a meaningful checkpoint where the project is in a usable state.

```markdown
## Milestones

**M1: Foundation (Phases 0-2)**
Description of what works at this point.

**M2: Core Functionality (Phases 3-4)**
Description of what works at this point.

**M3: Production Ready (Phases 5-6)**
Description of what works at this point.
```

### 2.8 Phase Summary Table

```markdown
| Phase | What | Depends On | Verification | Integration | Acceptance |
|-------|------|-----------|-------------|-------------|------------|
| 0 | Scaffold | -- | lint passes | -- | -- |
| 1 | Core logic | 0 | unit tests | -- | -- |
| 2 | Integration | 1 | unit tests | deploy to dev | -- |
| 3 | User interface | 2 | integration tests | end-to-end | user scenario |
```

---

## 3. Testing in Detail

### 3.1 Table-Driven Tests

When a function or component has multiple input/output cases, use a table-driven pattern instead of individual tests. This makes it easy to add cases and spot gaps.

**Application code:**
```
Test cases for "validate base DN":
| Input              | Expected          | Notes              |
| "dc=example,dc=org"| valid             | standard format    |
| "dc=example"       | valid             | single component   |
| ""                 | invalid           | empty string       |
| "not-a-dn"        | invalid           | missing dc=        |
```

**Infrastructure:**
```
Test cases for "LDAP role variables":
| Variable                | Value           | Expected Behavior         |
| openldap_tls_enabled    | false           | port 389 only, no certs  |
| openldap_tls_enabled    | true            | port 636, certs mounted   |
| openldap_users          | []              | no seed LDIF generated    |
| openldap_users          | [1 user]        | single user LDIF created  |
| openldap_users          | [5 users]       | multi-user LDIF created   |
```

### 3.2 Test Isolation

Tests must never touch production data, real infrastructure, or shared state.

| Project Type | Isolation Method |
|---|---|
| Application | Temp directories, env var overrides (`MYKB_DIR`, `HOME`), in-memory databases |
| Ansible | Dev/test VMs only, `--check --diff` first, separate inventory groups |
| Terraform | Dev subscription/resource group, separate state file, `plan` before `apply` |
| Docker | Local build + compose, no push to registry until verified |

### 3.3 Acceptance Test Structure

Every acceptance test has:
1. **Setup** — preconditions, seed data, environment preparation
2. **Action** — the thing being tested (login, deploy, query, connect)
3. **Verification** — specific, observable outcome (not "it works" but "response contains X")
4. **Teardown** — cleanup (optional if using disposable environments)

**Template:**
```markdown
**Test A.N — <Description>**
- Setup: <preconditions>
- Action: <command or step>
- Expected: <specific observable outcome>
- Pass criteria: <how to determine pass/fail>
```

---

## 4. Agent Workflow

When using AI agents (Claude Code subagents) for implementation, follow these patterns learned from experience.

### 4.1 Agent Prompts

The more specific the prompt, the better the output. Include:
- Exact files to read for context
- Function signatures or interface definitions to implement
- TDD steps with commit messages
- Working directory reminder
- Branch workflow instructions ("commit everything, push the branch")

### 4.2 Sequential vs Parallel

| Scenario | Approach |
|---|---|
| Phases that share a working directory | **Sequential only** — parallel agents cause merge conflicts and stray commits |
| Independent research tasks | **Parallel** — multiple research agents save significant time |
| Phases with true git worktree isolation | **Parallel OK** — each agent works on an isolated copy |

### 4.3 Agent Anti-Patterns

- **Parallel implementation agents sharing a working directory** — causes merge conflicts, stray commits on wrong branches
- **Assuming agents follow branch workflow** — they won't unless explicitly told
- **Rewriting spike patterns** — copy the exact working code from spikes, don't rewrite
- **Unbounded research agents** — set scope constraints to prevent runaway tasks
- **Gate-only enforcement** — catch violations in the steps, not just at the end

### 4.4 What to Delegate vs Keep

| Delegate to Agent | Keep for Human Review |
|---|---|
| Implementation of well-specified phases | Phase gate verification |
| Research and exploration | Design decisions and trade-offs |
| Test writing (when behavior is specified) | Acceptance test review |
| Documentation generation | Architecture choices |
| Boilerplate and scaffolding | Security-sensitive configuration |

---

## 5. Retrospective

After completing a significant piece of work, write a retrospective covering:

1. **What worked** — patterns and practices that should be repeated
2. **What didn't work** — mistakes and their root causes
3. **What could be improved** — actionable changes for next time
4. **Metrics** — tests written, phases completed, bugs found at each stage

The retrospective is a living document. Update it as you discover new patterns.

---

## 6. Quick Reference

### Starting a new piece of work
1. Read the ticket/requirement
2. Write a design document (or at minimum, a plan)
3. Identify unknowns → run spikes
4. Write the implementation plan with phases, gates, and tests
5. Review the plan before coding
6. Implement phase by phase with TDD
7. Phase gate between each phase
8. Acceptance test at each milestone
9. Write retrospective

### The TDD loop (any project type)
```
1. Define "what does working look like?" (RED)
2. Make it work with minimum effort (GREEN)
3. Clean up while it still works (REFACTOR)
4. Commit each step separately
5. Repeat
```

### Phase gate checklist (copy this)
```markdown
### Phase N Gate
- [ ] All verification checks pass
- [ ] Integration test passes
- [ ] No regressions
- [ ] TDD commit sequence in git log
- [ ] No hardcoded secrets or environment-specific values
- [ ] Documentation updated (if applicable)
```

### Commit message format
```
<type>: <description>

Types: test, feat, refactor, fix, docs, chore
No AI attribution. No emojis. Professional format.
```
