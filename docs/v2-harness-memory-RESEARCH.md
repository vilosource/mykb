# mykb v2 — Harness Memory Research Brief

**Date:** 2026-05-08
**Status:** Research — informs v2 architectural decisions, not yet a design doc
**Author:** Research conducted via web fetch + synthesis; primary sources cited inline
**Scope:** What has happened in agent harness memory since the mykb v0.3.0 checkpoint release (2026-03-22), and what mykb v2 should learn from it

## TL;DR

The field has converged on five primitives over the last 12-18 months. Four of them mykb already has, in some form. The two real architectural debts for v2 are **temporal validity on facts** (the Graphiti pattern) and **incremental delta-update curation** (the ACE/ICLR 2026 pattern). The two strategic moves are to **conform to the AGENTS.md and Agent Skills open standards** (so mykb's areas are usable outside pi too) and to **reframe mykb internally as an "evolving playbook" with delta updates** rather than a knowledge base — that is the vocabulary the field now uses, and it lines up with what the curator already wants to do.

A core architectural commitment is reaffirmed: **mykb v2 will not expose an MCP server.** Hooks are the primary integration path inside pi; the `kb` CLI is the secondary path for everything that requires the agent to think; cross-platform reach is solved by *exporting* SKILL.md and AGENTS.md fragments, not by exposing a live protocol surface. Reasoning is in §9.

## How this research was conducted

All claims below are taken from pages fetched from the open web on 2026-05-08. Sources are cited inline. Where dates appear in this document they are dates in the cited source. No claims are based on training-data recall; everything is grounded in a specific, fetchable URL. Raw extracted text from the research session is preserved at `/tmp/research/*.txt` for the duration of the session that produced this document.


## 1. The big shift since v0.3.0 (Mar 2026 → May 2026)

The whole field has converged on a vocabulary that did not exist 18 months ago, and a small number of architectural patterns now treated as obvious. The two phrases that swallowed everything are **"context engineering"** and **"harness design"**.

Reference posts that define the current state of the art:

- Anthropic Engineering, [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) (Sep 29, 2025) — formalised context engineering as the successor to prompt engineering. Core thesis: an LLM has a finite **attention budget** and suffers **context rot** as the window fills. Goal: *"find the smallest set of high-signal tokens that maximize the likelihood of your desired outcome."*
- Anthropic Engineering, [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) (Nov 26, 2025) — introduced the **initializer + coding agent** pattern that everyone now copies: a one-shot initializer creates `claude-progress.txt`, a feature checklist, and an init script. Every subsequent session begins by reading those, picks one feature, commits frequently, and updates the progress log before exit.
- Anthropic Engineering, [Harness design for long-running application development](https://www.anthropic.com/engineering/harness-design-long-running-apps) (Mar 24, 2026) — adds **GAN-style generator/evaluator separation** (planner + generator + evaluator), **sprint contracts** between agents, and the explicit observation that *"every component in a harness encodes an assumption about what the model can't do on its own — those assumptions are worth stress-testing because they go stale as models improve."* When Opus 4.6 shipped the team removed sprints and context resets entirely; the evaluator stayed only where the task sat at the edge of the model's solo capability.
- Anthropic Engineering, [Equipping agents for the real world with Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills) (Oct 16, 2025; promoted to **open standard at [agentskills.io](https://agentskills.io/)** Dec 18, 2025) — `SKILL.md` with YAML frontmatter, **progressive disclosure**: name+description always loaded, body loaded when relevant, bundled files loaded on demand. Now a cross-platform standard.

The field has standardised exactly the model mykb already bet on (three-tier context delivery, knowledge-as-skills) — but the vocabulary and the reference architecture are now everyone else's, not mykb's. v2 should adopt the shared vocabulary so mykb's design is legible to people coming from outside.

## 2. The single most important paper for mykb v2: ACE (ICLR 2026)

**Source:** Zhang et al., *Agentic Context Engineering: Evolving Contexts for Self-Improving Language Models*, [arXiv:2510.04618](https://arxiv.org/abs/2510.04618) v3 (Mar 29 2026), Stanford + SambaNova + UC Berkeley. Repo: [github.com/ace-agent/ace](https://github.com/ace-agent/ace), 1k stars, MIT. PyPI: [`agentic-context-engineering`](https://pypi.org/project/agentic-context-engineering/). Accepted at **ICLR 2026**.

This paper articulates the exact problem mykb's curator was designed to solve, names it, and provides a benchmark. It should be read first by anyone working on v2.

### 2.1 The two failure modes ACE names

| Failure mode | Definition | mykb implication |
|---|---|---|
| **Brevity bias** | Prompt optimisers (GEPA, etc.) collapse toward short generic instructions, dropping domain heuristics, tool-use guidelines, failure modes. | Our curator's instinct to consolidate facts into patterns can do this if it is not careful. The paper recommends **preserve detail, let the model distill at inference**. |
| **Context collapse** | Monolithic LLM rewrites of accumulated context degrade into shorter, less informative summaries over time. Documented case: AppWorld step 60 had 18,282 tokens at 66.7% accuracy → step 61 collapsed to 122 tokens at 57.1%, *worse than the no-curation baseline of 63.7%*. | Direct warning to mykb's curator if it ever does whole-area rewrites. **Do not LLM-rewrite an entire area as a single operation.** |

### 2.2 The ACE prescription, mapped to mykb

ACE = three roles + two mechanisms.

| ACE role | What it does | mykb equivalent |
|---|---|---|
| **Generator** | Produces reasoning trajectories on new queries; flags which existing context bullets were helpful or misleading. | The agent doing the actual work in pi. Already exists implicitly. |
| **Reflector** | Critiques traces, distills concrete insights from successes and errors. Optional multi-iteration refinement. | **New for v2.** mykb has signal collection and a curator, but no separated Reflector. The ACE ablation (§4.6) shows this separation is the load-bearing piece. |
| **Curator** | Synthesises lessons into **compact delta entries**, merged deterministically into context by lightweight non-LLM logic. | `kb work checkpoint` is a primitive Curator; the broader curator agent partly fits. **Key gap: the merge must be deterministic, not an LLM rewrite.** |

| ACE mechanism | What it is | mykb design move |
|---|---|---|
| **Incremental delta updates** | Context is a collection of **structured itemised bullets**. Each bullet has metadata (unique id, helpful counter, harmful counter) plus content. Updates are localised, parallelisable across multiple deltas. | **Adopt directly.** Add `helpful_count` and `harmful_count` to the entry envelope alongside the existing `verified`/`zone`. The Generator emits these signals during execution; the Curator does deterministic merge, never rewrite. |
| **Grow-and-refine** | New bullets appended; existing bullets updated in place (counter increments). Periodic de-dup via semantic embedding similarity. Refinement can be proactive (after each delta) or **lazy (only when context window exceeded)**. | mykb is already grow-mostly. Add lazy de-dup using embeddings (or BM25 + threshold) at promote/archive boundaries, not on every write. |

### 2.3 Performance numbers worth quoting

- **+10.6% on AppWorld agent benchmarks**
- **+8.6% on financial reasoning**
- **+17.1% peak on AppWorld** when learning from execution feedback alone (no labels)
- **−86.9% adaptation latency** versus existing adaptive methods
- **Beats top production agent** (IBM CUGA on GPT-4.1) with open-source DeepSeek-V3.1

These numbers exist because **the Reflector is separate from the Curator**. This is the single most important architectural recommendation in the paper.

### 2.4 Concrete v2 changes ACE implies

1. Entry envelope adds `helpful_count`, `harmful_count`, `last_used_at`. These are signal counters maintained by the Generator path, not the curator.
2. Promote/archive becomes signal-driven, not just time-driven. High harmful_count + low helpful_count → archive automatically.
3. The curator MUST emit deltas, not rewrites. Existing entries are touched only by counter increments or content patches. Whole-entry rewrites only on explicit user `kb update`.
4. Add a Reflector layer (likely a `kb work reflect` background subagent) that runs between session end and curator activation, taking traces + signals → candidate deltas. The curator just merges.
5. Multi-epoch refinement is worth the cost — re-run reflection over the same task traces multiple times; ablation shows real lift.


## 3. Temporal validity (Graphiti) — biggest architectural debt

**Source:** [github.com/getzep/graphiti](https://github.com/getzep/graphiti), Apache 2.0. Paper: [Zep: A Temporal Knowledge Graph Architecture for Agent Memory](https://arxiv.org/abs/2501.13956). MCP server v1.0.2 (March 2026).

### 3.1 What they have that mykb does not

> "A context graph is a temporal graph of entities, relationships, and facts — like 'Kendra loves Adidas shoes (as of March 2026).' Unlike traditional knowledge graphs, **each fact in a context graph has a validity window: when it became valid and when it stopped being valid**." — Graphiti README

Concretely: a **bi-temporal model** with explicit `valid_at` and `invalid_at` per fact, plus **automatic invalidation, not deletion**. Queries can ask "what is true now" or "what was true at any point in time."

### 3.2 Why this matters for mykb

mem0 explicitly flags this as an unsolved open problem in its [State of AI Agent Memory 2026](https://mem0.ai/blog/state-of-ai-agent-memory-2026): *"a highly-retrieved memory about a user's employer is highly relevant until it is not, at which point it becomes confidently wrong rather than just outdated."* Graphiti is the only system in the comparison guides that handles this cleanly.

mykb's *zone* model (active/established/archived) is one-dimensional. An entry moves between zones, but the history of when each fact was true is lost. The "fi-abakus migration" example in the postnord area is exactly where this hurts: the old hostname was true until a date and is now confidently wrong unless someone manually archived it.

### 3.3 v2 design move

Add to the JSONL envelope:

```ts
valid_from?: string;     // ISO8601, defaults to created_at
valid_until?: string;    // ISO8601, null means currently true
superseded_by?: string;  // id of entry that replaced this fact
```

Default retrieval becomes "facts where `valid_until` is null OR > now." Add a `kb history <area>` view that shows the full bi-temporal picture. This is also the honest answer to the curator's job when facts change: it should set `valid_until` on the old entry and write a new entry, never edit a fact in place.

### 3.4 Episodes / provenance

Graphiti also exposes "episodes" — the raw data that produced a fact, kept as a ground-truth stream. Every derived fact traces back. mykb already has `provenance` per entry but it is free-text. Consider **structured provenance** (commit hash, file:line, conversation-message id, tool-call id) so curator decisions are auditable. This is also an OWASP MCP08 (Lack of Audit and Telemetry) mitigation — see §6.


## 4. Conform to the standards: AGENTS.md and Agent Skills

The field has produced two open standards in the last seven months that mykb should align with.

### 4.1 AGENTS.md — open coding-agent rules format

**Source:** [agents.md](https://agents.md/). Supports **OpenAI Codex, Cursor, Aider, Goose, opencode, Zed, Warp, VS Code, Devin, JetBrains Junie, Amp, Gemini CLI, Kilo Code, Jules, Factory, RooCode, UiPath**. Pi already supports it (per the May 2026 pi review by Atal Upadhyay: *"Drop an agents.md file in your project root, and Pi loads it as context automatically"*).

**Implication for mykb:** when mykb is active, it should be able to **emit a project-scoped AGENTS.md** (or a fragment) from the area knowledge of any linked workspace. That is a one-way export that lights up agents that are not pi.

### 4.2 Agent Skills — the SKILL.md open standard

**Sources:** [agentskills.io](https://agentskills.io/) (open standard, Dec 18 2025), Anthropic's [Equipping Agents with Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills) (Oct 2025).

The format is exactly what mykb does conceptually:

```
my-skill/
├── SKILL.md       # YAML frontmatter (name + description) + body
├── scripts/       # executable code
├── references/    # docs
└── assets/
```

**Three-stage progressive disclosure:**

| Level | What loads | When | Token cost |
|---|---|---|---|
| 1. Metadata | `name` + `description` from YAML frontmatter | every session startup | ~100 tokens per skill |
| 2. Body | Full SKILL.md | when triggered (agent reads via `bash`) | < 5k tokens |
| 3. Bundled files | Referenced files in skill folder | as needed | unbounded |

This is the same three-tier model mykb uses (area index → on-demand fact injection → full area load). The difference is mykb does Level 1 by *injecting* into the system prompt, while Skills does Level 2/3 by *the agent reading files via bash*. Both are valid; mykb's is lower-latency, Skills is more portable.

### 4.3 v2 design move: dual-format areas

Make a mykb area renderable as a Skill:

```
~/.mykb/areas/postnord/
├── area.json
├── SKILL.md            ← NEW: auto-generated from area summary + index
├── facts.jsonl
├── decisions.jsonl
├── ...
└── references/         ← NEW: optional bundled files for Level-3 disclosure
```

The auto-generated `SKILL.md` has YAML frontmatter (`name: postnord`, `description: "<area summary>. Use when working on PostNord WMS migration, fi-sr-012, ServiceMix, LogMaster integration."`) and a body that is the existing area index. Agents that do not speak mykb (Claude Code, Cursor, Codex) can use it as a Skill via the standard. Agents that do (pi via mykb) get the richer experience.

This single move makes mykb interoperable with the entire 14-tool AGENTS.md ecosystem **and** the Agent Skills ecosystem with no behavioural change to mykb's own delivery. It is the highest-leverage cross-platform play available.


## 5. Anthropic's harness pattern is now the reference architecture

**Sources:** the three Anthropic engineering posts cited in §1.

### 5.1 Their canonical pattern, mapped to mykb

| Anthropic harness primitive | mykb equivalent | Status |
|---|---|---|
| `claude-progress.txt` log | workspace journal + handoff | shipped |
| Feature checklist | workspace `state` (phase/active/blocked/next) | shipped |
| Initialiser agent that bootstraps state | `kb work create` + first-session ramp | partial — no automated initialiser |
| Read-progress-first session start protocol | `kb work start` shows Resume + state + recent journal | shipped |
| Structured artifacts handed off between sessions | WSA — designed, not yet shipped | deferred |
| **Context resets** with a handoff artifact (vs. compaction) | not currently exposed as a primitive | missing |
| Generator/Evaluator/Planner separation | not currently mykb's concern | n/a |
| *"Every harness component encodes an assumption about model weakness — revisit it as models improve."* | curator and scorer were designed for Sonnet-class models | worth re-validating against Opus 4.6 |

### 5.2 Concrete v2 design moves

1. **Ship workspace artifacts (WSA).** Already designed (see `docs/workspace-artifacts-DESIGN.md`). Anthropic's Mar 2026 post made it the canonical handoff primitive. Do not ship v2 without it.
2. **Add `kb work reset`** that produces a fresh-context handoff artifact compact enough to paste into a new conversation as a context-reset prompt. This is the "structured handoff" Anthropic identifies as the load-bearing piece for very long tasks.
3. **Re-audit every part of the curator and scorer** against Opus 4.6 / Sonnet 4.6. Anthropic's own evaluators became "no longer load-bearing for tasks within model capability" after Opus 4.6. Many of mykb's defensive tactics may now be over-conservative.
4. **Compaction vs. context reset is now a documented design decision.** Document mykb's stance: workspaces survive compaction by living outside the conversation; the handoff exists for hard resets. State this explicitly in CLAUDE.md and the user docs.

### 5.3 Anthropic "dreaming" (May 6, 2026) — the curator productized

Reported in [Business Insider](https://www.businessinsider.com/anthropic-dreaming-ai-agents-2026-5):

> "The technique is meant to refine a system's memory by running evaluations between sessions. It will review old behavior and seek patterns, then help agents establish better ways of working and cut down on mistakes."

This is mykb's curator design productized as a research preview for the Claude Developer Platform. Three takeaways:

1. **The market validates the curator concept.** Stop defending the idea; focus on the implementation.
2. **"Between sessions" matters.** mykb's curator should run as a background pass, not synchronously. The existing checkpoint background-subagent pattern (CLAUDE.md harness convention) is the right shape; extend it to curation.
3. **There will be a Claude-native version eventually.** mykb's differentiation has to be: portability across providers (mykb runs against any pi-supported provider), local-first (no cloud), and the bi-temporal/audited knowledge model (which Anthropic has not signaled). Build accordingly.


## 6. Security: OWASP MCP Top 10 and what mykb gets right or wrong

**Source:** [OWASP MCP Top 10](https://owasp.org/www-project-mcp-top-10/) (Beta, RSA 2026 release). The reference list also informs OWASP's broader Agentic Applications Top 10. Other sources note **30+ CVEs hit MCP servers in the first months of 2026** ([practical-devsecops.com](https://www.practical-devsecops.com/owasp-mcp-top-10/)).

| OWASP MCP risk | mykb posture today | v2 action |
|---|---|---|
| **MCP01 Token Mismanagement** | mykb has no tokens; credentials live elsewhere | n/a |
| **MCP02 Privilege Escalation via Scope Creep** | tool gating blocks edits to JSONL; tools scoped to brain dir | maintain |
| **MCP03 Tool Poisoning** | mykb's tools are local; trust model is the operator | document threat |
| **MCP04 Supply Chain (Dependency Tampering)** | npm package, native deps (better-sqlite3) — known surface | pin deps, add `npm audit` to CI |
| **MCP05 Command Injection** | scorer.ts FTS5 sanitization fix already addressed (tracked in mykb area knowledge) | maintain pattern; audit all FTS5 query construction |
| **MCP06 Intent Flow Subversion (memory poisoning)** | **biggest mykb risk**: the curator and Tier-2 injection both put untrusted content into the system prompt | **Add a "trust level" per entry** (operator-written / agent-extracted / external-import); only operator-written entries land in Tier-1 system-prompt without review |
| **MCP07 Insufficient Auth** | local single-user today; mykb knowledge already flags corporate-KB v2 ambitions | unblock v2 corporate scope work |
| **MCP08 Lack of Audit/Telemetry** | provenance is free-text; curator actions not always logged | structured provenance + curator audit log (matches Graphiti's "episodes" idea, see §3.4) |
| **MCP09 Shadow MCP Servers** | n/a, mykb is in-process | n/a |
| **MCP10 Context Injection & Over-Sharing** | **multi-instance gotcha already documented in mykb knowledge** (`.active` race) is exactly this risk class | session isolation is already designed; ship it in v2 |

The **CVE-2026-32247 Cypher injection in Graphiti** (March 2026, fixed in graphiti-core 0.28.2) is the canonical worked example: prompt injection → malicious tool args → backend query injection. mykb's existing tool-gating is the right defense; lock down all FTS5 query construction the same way `sanitizeFtsQuery()` was patched.


## 7. Reranker layer (mem0)

**Source:** mem0 v1.0 release notes, [State of AI Agent Memory 2026](https://mem0.ai/blog/state-of-ai-agent-memory-2026) (mem0.ai blog, May 2026).

mem0 made **reranking the default in v1.0** (Cohere, ZeroEntropy, HuggingFace, Sentence-Transformers, or LLM-based). Justification:

> "Vector similarity search returns a candidate set, but the **ordering of that candidate set is often wrong**. A reranker is a second-pass model that re-scores the candidates based on the query."

mykb's `scorer.ts` is single-pass BM25-style, ordered by score directly. The two-stage pattern is now table stakes.

### 7.1 v2 design move — two-stage retrieval in scorer

1. **Stage 1 (cheap, fast):** FTS5 BM25 keyword match returns top-K candidates (K = 20-50). Deterministic, no LLM. Already what mykb does.
2. **Stage 2 (re-rank):** small LLM call (or sentence-transformer locally) re-scores against the actual current task signals. Returns top-N (N = 3-7) for Tier-2 injection.

Stage 2 is optional/configurable. Default off for cost; recommend on for users with capable local embedders. mem0's ablation reported a real lift.

This also gives mykb a clean place to inject the **helpful_count / harmful_count** ACE signals as a re-ranking factor, closing the loop with §2.

## 8. Procedural memory as a first-class type (mem0)

**Source:** mem0 v1.0 added `memory_type="procedural_memory"` — routes through a different extraction prompt focused on workflows, not facts/preferences.

mykb has *patterns* — and the mykb knowledge area itself documents that **patterns survive across project boundaries best (42% retention OSB→mykb)** while facts do not (4%). This is independent confirmation that **procedural memory is the durable knowledge type.**

### 8.1 v2 design move

Make patterns first-class in two senses:

1. **Different curator extraction prompt for patterns** (focus on "how", not "what"). Most mykb areas have a low pattern-to-fact ratio because the curator's default prompt extracts facts. Splitting the prompt should raise that ratio.
2. **Patterns get heavier weight in Tier-2 scoring.** They are more durable, so they should out-rank facts of equal recency.


## 9. The MCP question — explicit non-decision

**Decision: mykb v2 will not expose itself as an MCP server.** This section records the reasoning so the question does not have to be re-litigated later.

### 9.1 The MCP project itself deprioritised memory

From the [MCP 2026 Roadmap](https://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/) (post-Nov 2025 spec, current as of fetch on 2026-05-08):

> "Core maintainers ranked candidate areas, and the result was a clear top four: Transport Evolution, Agent Communication (Tasks primitive), Governance Maturation, Enterprise Readiness. SEPs aligned with the priority areas above will move the fastest. SEPs outside those areas aren't automatically rejected, but they face longer review timelines."

Memory is not a priority area. It is "On the Horizon" or pushed to extensions. The MCP project explicitly does not want memory in core.

### 9.2 The security record for MCP memory is bad

From [OWASP MCP Top 10](https://owasp.org/www-project-mcp-top-10/) and the comparison guides:

- **30+ CVEs hit MCP servers in the first months of 2026 alone.**
- **Graphiti CVE-2026-32247** — Cypher injection via prompt injection through `search_nodes` (high severity, fixed in graphiti-core 0.28.2).
- **mem0 OpenClaw integration: 6 CVEs** including path traversal.
- **OWASP MCP06 (Intent Flow Subversion)** and **MCP10 (Context Injection & Over-Sharing)** are specifically about poisoning working memory through MCP channels.

Every memory MCP server in the field has either had a published CVE in the last 90 days or is too small to have been audited. That is the structural cost of putting memory behind a network protocol where the LLM authors the arguments.

### 9.3 Pi's own philosophy aligns

The "[you don't need MCP](https://mariozechner.at/posts/2025-11-02-what-if-you-dont-need-mcp/)" essay is a foundational pi-mono document. mom (pi-mom) explicitly does **skills as CLI tools** rather than MCP servers. mykb conforming to that is consistent with the host platform's design intent.

### 9.4 The 14-tool AGENTS.md ecosystem proves the alternative

`agents.md` works across OpenAI Codex, Cursor, Aider, Goose, opencode, Zed, Warp, VS Code, Devin, Junie, Amp, Gemini CLI, Kilo, Jules, Factory, RooCode, UiPath. None need MCP to read a Markdown file or shell out to a CLI. **A `kb` binary on PATH is more portable than an MCP server**, because it works in environments that do not speak MCP at all (CI, containers, raw shells, scripts).

### 9.5 Hooks vs. MCP — what each actually provides for mykb

| Need | Pi hooks | MCP server |
|---|---|---|
| Inject context every turn (Tier 2) | ✅ `pi.on('context')` direct, in-process, deterministic | ❌ MCP can't push — only LLM can pull |
| Block edits to brain files | ✅ `pi.on('tool_call')` returning a non-null result | ⚠️ would need a separate gateway server |
| Inject area index into system prompt at startup | ✅ `before_agent_start` | ❌ same as above |
| Capture tool_result signals for relevance scoring | ✅ direct hook | ❌ MCP server has no view into other tools |
| Cross-session persistence | ✅ in-process file I/O | ✅ tools work too |
| Cross-platform (non-pi agents) | ⚠️ pi-only at runtime | ✅ portable |
| Authoring knowledge (decisions, facts, gotchas) | ⚠️ via slash command or tool | ✅ via tool |
| LLM-driven knowledge lookup | ✅ via in-process tool | ✅ via MCP tool |

Hooks beat MCP at six of nine cells; MCP only wins on cross-platform. And cross-platform is solved cleanly by §4: **emit AGENTS.md and SKILL.md from areas**. Those work everywhere, no MCP needed.

### 9.6 The CLI fallback is the real cross-platform story

Anthropic's own current best practice for non-pi environments (from the Claude Code memory levels article and the Mar 2026 harness post):

> "An agent with a filesystem and bash tool doesn't need to read the entirety of a skill into context. The amount of context bundled into a skill is effectively unbounded."

Translation: **bash + a binary on PATH is the universal interface.** mykb already provides that. `kb load <area>`, `kb search`, `kb add fact`, `kb work *` are all bash-callable. Any agent in the AGENTS.md ecosystem can shell out to `kb` exactly the way Claude Code skills shell out to bash. **No MCP server needed; the CLI already is the integration point.**


## 10. pi-mem — the worked counter-example

**Source:** [pradeep.md/2026/02/11/pi-mem.html](https://pradeep.md/2026/02/11/pi-mem.html); repo [github.com/skyfallsin/pi-mem](https://github.com/skyfallsin/pi-mem) (now mirrored at `jo-inc/pi-mem`).

pi-mem is the "intentionally dumb" sibling of mykb. **Same Pi extension API, same `before_agent_start` hook, three Markdown files, no SQLite, no scorer.** Roughly 460 LOC.

### 10.1 What pi-mem has that mykb does not

- **Daily logs** (`daily/YYYY-MM-DD.md`) — append-only chronological session journal, **today + yesterday auto-loaded into context every session**. mykb has workspace journal but does not auto-load N days back into the system prompt.
- **PI_CONTEXT_FILES env-var convention** to inject arbitrary identity/personality files (SOUL.md, AGENTS.md, HEARTBEAT.md). mykb has no convention for "always inject these files."
- **`memory_search` tool** that does file-content keyword search. mykb has it for knowledge entries but not for workspace artifacts/journal text.
- **A startup dashboard widget** that summarises the last 24h via a single LLM call.
- **One-line install:** `pi install git:github.com/skyfallsin/pi-mem`. mykb requires a native-deps build inside the container.

### 10.2 What pi-mem does not have (mykb's edge)

- No areas / topical organisation
- No verification/promotion lifecycle
- No structured entry types (everything is freeform Markdown)
- No FTS5 / SQLite cache
- No multi-workspace concept
- No tool gating
- Not bi-temporal, not delta-based
- Author explicitly admits: *"two days of daily logs plus MEMORY.md plus scratchpad can get chunky"* — no scaling story past a single project

### 10.3 v2 design moves inspired by pi-mem

1. **Auto-inject the last N days of workspace journal** into the system prompt at session start. Configurable; default N=2. Highest-leverage missing feature for "no cold start" — and it is small.
2. **Workspace SOUL.md / HEARTBEAT.md convention** — let the operator drop identity files in `~/.mykb/workspaces/<id>/context/` that are auto-injected. Cheap, valuable.
3. **Make installation easier.** pi-mem is 460 LOC pure-TS, no native deps. mykb requires `better-sqlite3` compiled inside the container. Either ship pre-built binaries, or have a fallback "JSONL-only" mode that runs without SQLite for installations where the native build fails.
4. **Optional dashboard widget** showing recent activity at startup — pi-mem proves it is worth the small LLM call.


## 11. Where mykb stands today (honest scorecard)

The architecture aged extremely well. The table below maps existing mykb design choices to current 2026 industry state.

| mykb design choice | 2026 industry state |
|---|---|
| Three-tier context delivery (index in system prompt → auto-injected facts → on-demand `/kb`) | **Identical** to Anthropic Skills' progressive disclosure (Oct 2025, standardised Dec 2025) |
| JSONL + SQLite hybrid, JSONL as source of truth | Basic Memory (Markdown) and Engram (SQLite+FTS5) converged on the same shape |
| FTS5 keyword-exact search | Engram does the same. mem0 went vector + rerank; field is split |
| Knowledge-as-skills, context-triggered matching | Anthropic Agent Skills standard at agentskills.io |
| Workspaces + handoff + journal + checkpoint | Anthropic harness pattern (`claude-progress.txt`) is the same idea |
| Tool gating to block edits to knowledge files | OWASP MCP Top 10 (Apr 2026) lists memory poisoning as a top threat — design is correct by today's security standards |
| Curator agent (FTS5 detect → LLM analyze → trust levels) | ACE (ICLR 2026) names it generation/reflection/curation; Anthropic's "dreaming" productizes the inter-session variant |
| Pi extension model | Validated by `pi-mem` (Feb 2026) — same hooks, same `before_agent_start` pattern |
| Zone lifecycle (active/established/archived) + verify/promote | Still ahead of the field — addresses the "high-relevance becomes confidently wrong" gap mem0 explicitly flags as open |
| Pattern-to-fact ratio as a health metric | Nobody else has this |

### 11.1 Where the field has moved past us

- **Temporal validity windows on facts** (Graphiti). Facts are point-in-time, not interval. Needed for "X used to be true."
- **Reranker layer on retrieval.** mem0 made it default. Scorer is BM25-only.
- **Multi-scope IDs** (`user_id` × `session_id` × `org_id`). mykb has areas + workspaces; no user.
- **Actor-aware provenance.** For multi-agent settings, who made each entry matters. mykb has provenance but not actor tagging.
- **Procedural memory** as an explicit type. mem0 made this first-class with its own extraction prompt. mykb has *patterns* (roughly equivalent), but extraction discipline is curator-side, not API-side.
- **Context-reset + handoff artifact** as the canonical pattern. mykb has handoff + checkpoint, fits this. WSA (still on roadmap) is the missing structured-artifact piece.
- **Skills as cross-platform standard.** agentskills.io (Dec 2025). mykb skills should conform so they work in Claude Code too.
- **ACE-style helpful/harmful counters and delta updates.** Curator currently rewrites; needs to emit deltas instead.


## 12. Revised v2 architecture — hooks + CLI only

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 0 — Brain (~/.mykb/)                                  │
│  JSONL source of truth + SQLite cache + workspace state      │
│  Bi-temporal facts (valid_from/valid_until/superseded_by)    │
│  ACE-style entries (helpful_count/harmful_count)             │
└─────────────────────────────────────────────────────────────┘
              ▲                                ▲
              │ in-process                     │ subprocess
              │                                │
┌─────────────┴────────────────┐  ┌────────────┴───────────────┐
│  Layer 1 — pi extension       │  │  Layer 2 — kb CLI          │
│  (the "hooks" path)           │  │  (the "execute" path)      │
│                               │  │                            │
│  before_agent_start: Tier 1   │  │  kb load <area>            │
│  context: Tier 2 + rerank     │  │  kb search <query>         │
│  tool_call: gating + signals  │  │  kb add fact/decision/...  │
│  tool_result: helpful counter │  │  kb work *                 │
│  session_shutdown: kb save    │  │  kb verify/promote/archive │
│  /kb command: Tier 3          │  │  kb skill render <area>    │
│                               │  │  kb agents-md emit         │
│  Pi-only, deterministic       │  │  Provider-agnostic, any sh │
└───────────────────────────────┘  └────────────────────────────┘
              ▲                                ▲
              │                                │
┌─────────────┴────────────────────────────────┴───────────────┐
│  Layer 3 — Standards exports (one-way, no protocol)          │
│  Per-area SKILL.md (agentskills.io, Dec 2025)                │
│  Per-workspace AGENTS.md fragment                            │
│  Per-area MEMORY.md (Claude Code Auto Memory format)         │
└──────────────────────────────────────────────────────────────┘
```

### 12.1 Design principles, restated

1. **Hooks are the primary integration path inside pi.** Anything that needs to happen automatically — context injection, gating, signal collection, session end — happens via Pi hooks. The agent never has to "decide" to do these.
2. **The CLI is the secondary integration path for everything else.** Anything the agent should think about doing (recording a decision, loading an area, looking up a fact, running a curator pass) happens by the agent invoking `kb` from bash. This matches how Claude Code skills work and how every AGENTS.md tool works.
3. **No network protocol surface.** No MCP server. No HTTP server. mykb is files on disk + a CLI + a Pi extension. Eliminates an entire class of OWASP risks.
4. **Cross-platform is solved by export, not protocol.** Areas render to SKILL.md (Agent Skills standard) and AGENTS.md fragments. Any agent in either ecosystem reads them as plain files. No live integration — and therefore no integration security surface — required.

### 12.2 The agent's mental model

Inside pi: "memory just appears." Tier 1 area index is in the system prompt; Tier 2 facts get injected each turn; tool gating prevents footguns. The agent does not need to know mykb exists.

When the agent does need to know: "I should record this decision" → bash → `kb add decision <area> "..." --why "..."`. "What do we know about postnord?" → bash → `kb load postnord`. Same mental model as `git`, `gh`, `npm` — a CLI you reach for when you need it.

### 12.3 Hook-driven vs. agent-decided — explicit boundary

| Action | Mechanism | Why |
|---|---|---|
| Inject area index at session start | hook (`before_agent_start`) | Deterministic, can't be skipped |
| Inject relevant facts each turn | hook (`context`) + reranker | Latency-sensitive, no LLM choice |
| Block edits to JSONL files | hook (`tool_call` gate) | Security; OWASP MCP06 mitigation |
| Update helpful/harmful counters | hook (`tool_result` signal) | Background, agent shouldn't think about it |
| Auto-save brain on shutdown | hook (`session_shutdown`) | Reliability |
| Background curator pass | hook (`session_shutdown` triggers subagent) | Doesn't block the conversation |
| Auto-load last N days of journal | hook (`before_agent_start`) | "No cold start" — pi-mem inspired |
| Record a decision/fact/gotcha | **agent runs `kb add ...`** | Requires judgment about what's worth keeping |
| Look up cross-area knowledge | **agent runs `kb search` or `/kb load`** | On-demand, agent knows when it needs context |
| Verify or promote an entry | **operator runs `kb verify`/`kb promote`** | Human authority |
| Render area as SKILL.md | **operator runs `kb skill render`** | One-time export to other tools |

This is a cleaner contract than v0.3.0, where some "agent should decide" actions are tangled into hooks (curator nudges, etc.).


## 13. Phased v2 work plan

| Phase | Theme | Concrete deliverables |
|---|---|---|
| **v0.4** | ACE-isms | Add `helpful_count`/`harmful_count` to envelope. Curator emits deltas, never rewrites. Reflector subagent on session end. Two-stage rerank in `scorer.ts`. |
| **v0.5** | Bi-temporal facts | Add `valid_from`/`valid_until`/`superseded_by`. Default queries filter to currently-valid. `kb history <area>` view. Structured provenance. |
| **v0.6** | Standards exports | `kb skill render <area>` produces SKILL.md per agentskills.io. `kb agents-md emit` writes a workspace AGENTS.md fragment. |
| **v0.7** | Pi-mem-inspired niceties | Auto-inject last N days of workspace journal. PI_CONTEXT_FILES convention. Optional startup dashboard widget. Easier install (pre-built better-sqlite3 or JSONL-only fallback). Ship WSA. |
| **v1.0** | Session isolation + audit + corporate scope | Ship the `KB_SESSION_ID` design (multi-instance safety). Curator audit log (OWASP MCP08). Trust-level per entry (OWASP MCP06). Begin corporate-KB scope work (multi-user, GraphQL, Gel/Postgres backend per existing graph backend design docs). |

No MCP server appears anywhere. The cross-platform story is **export to SKILL.md / AGENTS.md + the `kb` binary on PATH**, both of which are pure files-and-bash, no protocol.

## 14. Open problems (mem0's list, plus mykb-specific)

mem0 explicitly flags as unsolved in 2026:

1. **Application-level memory eval.** LOCOMO measures generic recall. There is no shared notion of "correct" memory behavior for a specific use case. Bespoke for everyone.
2. **Privacy/consent architecture.** Inspect/edit/delete UX, audit, retention — application-layer concerns, no standards.
3. **Cross-session identity resolution.** Same human across devices/auth methods → same memory space.
4. **Memory staleness at scale.** Decay handles low-relevance entries. The hard case is **high-relevance memory becoming confidently wrong**. mykb's bi-temporal v2 (§3) addresses this directly.

mykb-specific opens:

5. **Curator evaluation.** How do we know the curator is improving the area, not damaging it? Need an offline replay mechanism that scores curator decisions against held-out future-session signals.
6. **Cross-workspace knowledge promotion.** When a fact in one workspace becomes relevant to others, today there is no signal. ACE's helpful_count gives a candidate trigger.
7. **Skill-format conformance testing.** A `kb skill render` output should be drop-in usable by Claude Code without manual editing. Need a conformance test suite.

## 15. Reading list (do these first)

For anyone picking up v2 work, read in this order:

1. [Anthropic — Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) (Sep 2025) — vocabulary
2. [Anthropic — Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) (Nov 2025) — initialiser pattern
3. [Anthropic — Harness design for long-running application development](https://www.anthropic.com/engineering/harness-design-long-running-apps) (Mar 2026) — generator/evaluator + harness-as-stale-assumption
4. [ACE paper — arXiv 2510.04618](https://arxiv.org/abs/2510.04618) (ICLR 2026) — Reflector, deltas, grow-and-refine
5. [ACE GitHub repo](https://github.com/ace-agent/ace) — Python reference impl, MIT
6. [agentskills.io](https://agentskills.io/) and [Anthropic Agent Skills post](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills) — the standard mykb should export to
7. [agents.md](https://agents.md/) — the cross-tool rules standard
8. [Graphiti README](https://github.com/getzep/graphiti) and [Zep paper arXiv 2501.13956](https://arxiv.org/abs/2501.13956) — bi-temporal fact model
9. [pi-mem](https://github.com/skyfallsin/pi-mem) — sibling extension, 460 LOC, useful diff
10. [OWASP MCP Top 10](https://owasp.org/www-project-mcp-top-10/) — security taxonomy

## 16. Decisions this document commits to

The following are recorded as v2 architectural commitments. They should be propagated into mykb knowledge via `kb add decision mykb` once this doc is reviewed.

1. **No MCP server.** Hooks + CLI + standards exports only. (§9)
2. **Adopt ACE delta-update semantics** in the curator. No whole-area rewrites. Add `helpful_count`/`harmful_count` to entry envelope. (§2)
3. **Add bi-temporal validity** (`valid_from` / `valid_until` / `superseded_by`) to the fact envelope. (§3)
4. **Conform to AGENTS.md and Agent Skills standards** via one-way exports. (§4)
5. **Two-stage retrieval** in `scorer.ts`: BM25 candidate + optional rerank. (§7)
6. **Procedural memory (patterns)** gets a dedicated curator extraction prompt and Tier-2 weighting. (§8)
7. **Auto-inject recent workspace journal** (last N days, default 2) at session start. (§10)
8. **Trust level per entry** (operator / agent / import); only operator-trusted entries land in Tier-1 without review. (§6)
9. **Structured provenance** (commit hash, file:line, message id, tool-call id). (§3.4, §6)
10. **Re-audit curator and scorer against Opus 4.6** before locking v2 scope; over-conservative defenses likely no longer needed. (§5.2)

---

**Document status:** research brief, not yet a design doc. Next step is to convert each commitment in §16 into a focused DESIGN.md and to decide phase ordering against the mykb roadmap.

