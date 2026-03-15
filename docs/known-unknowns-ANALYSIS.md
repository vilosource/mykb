# mykb — Known/Unknowns Analysis

Date: 2026-03-15

This document maps what we know, what we know we don't know, and where the blind spots are. Use this to prioritize validation during implementation — prove the unknowns early, before building on top of them.

---

## Known/Knowns — Things we are confident about

These are validated by OSB v1 production use, research, or established patterns.

### Knowledge Model
- **Areas work.** 17 areas in production for months. The concept of domain-specific knowledge that accumulates over time is proven.
- **Facts, decisions, gotchas, patterns, links** — the taxonomy covers what developers actually capture. OSB v1 validated this across infrastructure, customer, and tooling domains.
- **Provenance matters.** Stale knowledge is dangerous. Knowing when a fact was last verified prevents the AI from acting on outdated information. Proven through OSB v1's audit system.
- **Progressive summarization (zones) works.** Active → established → archive lifecycle prevents knowledge bloat while keeping important facts accessible.
- **Tags enable sub-area retrieval.** `#dns`, `#runners`, `#rbac` — filtering within an area is necessary when areas grow large.

### Storage
- **JSONL + SQLite hybrid is proven.** Engram (18k stars) and Beads (18k stars) independently validated this pattern for agent memory with git.
- **Append-only JSONL merges cleanly in git.** No merge conflicts on concurrent additions. This is a property of the format, not implementation-dependent.
- **SQLite + FTS5 handles our scale.** 500 facts today, 10k target. FTS5 queries at <5ms for this scale is well-documented.
- **JSONL is AI-proof.** Unlike markdown, the AI doesn't try to edit JSONL files. This was the core problem with OSB v1's BRAIN.md format.

### Harness
- **Pi's extension API exists and works.** `tool_call`, `tool_result`, `context`, `input`, `before_agent_start`, `session_start`, `session_shutdown` — all documented with examples in Pi's source.
- **Pi's `tool_call` can block with a reason.** Verified in Pi docs. This enables mechanical enforcement that Claude Code couldn't provide.
- **Pi auto-discovers extensions.** Drop files in `~/.pi/agent/extensions/` — no install command needed.
- **Pi Package distribution via npm works.** `pi install npm:@scope/package` — standard Pi workflow.

### Delivery
- **Always-loaded context outperforms on-demand.** Vercel's eval: 100% pass rate with AGENTS.md vs 53% with skills. This validates Tier 1 (always-loaded area index).
- **Skills get ignored 56% of the time.** This validates our decision to use context injection (Tier 2) over suggestions/nudges.

---

## Known/Unknowns — Things we know we need to figure out

These are identified risks and open questions. Each needs validation during implementation.

### Pi Integration

**~~Will Pi's `context` event work as our Tier 2 delivery mechanism?~~**
VALIDATED (Spike 01). Yes — `context` event modifies the message array, AI sees and uses the injected facts. Latency overhead negligible (~4s total including container startup). Tested with z.ai provider. Remaining question: behavior with multiple extensions and different providers.

**~~Will `tool_call` blocking actually redirect the AI?~~**
VALIDATED (Spike 02). Yes — AI gets blocked, reads the reason message, and switches to the registered `kb_add` tool without being told. Does not retry or loop. Gotcha: property is `event.toolName` (camelCase), not `event.tool`. Remaining question: behavior across different LLM models/providers.

**~~Does `better-sqlite3` work reliably inside Pi's Node.js process?~~**
VALIDATED (Spike 03). Yes — native module loads, FTS5 extension available, queries return correct results. Host-compiled module (Node.js 20) works in Pi container (also Node.js 20). No `sql.js` fallback needed.

### Relevance Scoring

**Is FTS5 BM25 good enough for area matching?**
We chose FTS5 over embeddings for simplicity. But BM25 is keyword-based — it won't match "working on infrastructure-as-code" to an area about "Terraform modules and Ansible playbooks" unless those exact words appear. Need to test with real prompts against real area data to measure hit rate.

**Is 2000 tokens the right Tier 2 budget?**
Arbitrary number. Too low = missing relevant context. Too high = drowning the AI in knowledge it doesn't need, degrading reasoning quality. Need to experiment with real sessions. May need to be provider/model-dependent.

**How do we count tokens?**
Different models tokenize differently. We need either a tokenizer (tiktoken for OpenAI, claude tokenizer for Anthropic) or a heuristic (chars/4). The heuristic is faster but less accurate. Does the inaccuracy matter for a budget that's inherently approximate?

### Data Integrity

**What happens on partial JSONL writes?**
If the process crashes mid-append, we get a truncated JSON line. The hydration process needs to handle this — skip malformed lines, log a warning. Not hard to implement but needs to be designed for.

**Does stale detection via mtime work across git operations?**
`git pull`, `git checkout`, `git stash pop` all modify file mtimes. But `git clone` preserves mtimes from the remote? Need to verify. If mtimes are unreliable after git operations, we may need a different staleness signal (e.g., compare git HEAD hash against a stored hash).

**Nanoid collision probability at scale?**
8-character alphanumeric nanoid = 62^8 = ~218 trillion combinations. At 10k facts, collision probability is negligible (~1 in 21 billion). But worth noting as a non-issue rather than an unknown.

### User Experience

**Will auto-area-creation lead to area sprawl?**
When `kb add fact my-area "text"` auto-creates `my-area`, users might create many poorly-named or redundant areas. Typos become permanent areas (`ci-piplines` vs `ci-pipelines`). Mitigation: `kb list` makes areas visible, `kb area delete` removes them, and the manifest keeps the index small. But sprawl could still be a practical problem.

**How should compaction be triggered?**
`kb compact` exists but when should the user run it? After how many updates? Automatically on `kb save`? On a JSONL size threshold? If compaction is manual, it will be forgotten. If automatic, it might run at a bad time.

**What's the migration experience from OSB v1?**
`kb import osb <path>` is designed but untested. The OSB markdown parser is in Go — we need to reimplement parsing in TypeScript. Edge cases: multi-line facts, provenance annotations with special characters, decisions split across BRAIN.md and decisions.md.

### Architecture

**Can the extension and CLI share a SQLite connection safely?**
WAL mode allows concurrent readers. But if the user runs `kb add` in a terminal while the extension is mid-query, does WAL handle this correctly across separate processes? SQLite documentation says yes, but we should verify with `better-sqlite3` specifically.

**How does the extension handle brain access during Pi startup?**
The extension's `session_start` handler runs early. If it tries to open SQLite and hydrate before the file system is fully ready (e.g., network-mounted home directory), it could fail. Need graceful handling of slow/missing brain at startup.

---

## Unknown/Unknowns — Blind spots and emerging risks

These are areas where we don't yet know what we don't know. They represent the highest risk because we can't plan for them directly. The strategy is to identify risk surfaces and build in flexibility.

### How will different LLM providers react to injected context?

We're injecting `<mykb-context>` blocks into the message history via Pi's `context` event. Every model sees this differently:
- Anthropic models may treat XML tags specially
- OpenAI models may ignore or deprioritize injected system-style messages
- Smaller models may be overwhelmed by additional context
- Some models may try to "respond to" the injected knowledge instead of using it passively

We don't know how each provider/model handles this because we haven't tested it. The format and injection strategy may need to be model-aware.

### What happens when knowledge contradicts the AI's training data?

If a fact says "our database runs on port 3307" but the AI's training says MySQL runs on 3306, which wins? Does the AI trust the injected knowledge or its own training? This likely varies by model, by how the knowledge is presented, and by how confidently it's stated. We have no data on this.

### How does context injection affect reasoning quality?

Adding 2000 tokens of knowledge to every turn means the AI has more to process. Research on "lost in the middle" suggests models pay less attention to content in the middle of long contexts. Does injecting knowledge at the beginning (prepended to messages) avoid this? Does the injection position matter? Does more knowledge actually make the AI worse at its primary task?

### Interaction with other Pi extensions

Other Pi extensions may also subscribe to `context`, `tool_call`, `tool_result` events. Pi chains handlers — each extension's modifications feed into the next. If another extension modifies the message array, our injected knowledge might get moved, modified, or removed. We don't control the execution order.

### Area boundary discovery

We defined areas based on OSB v1's experience. But new users starting from scratch won't know how to organize knowledge. When should something be a new area vs a tag in an existing area? When should two areas merge? The system provides no guidance on this — it's left to user judgment, which may be poor.

### Knowledge decay patterns

We have freshness thresholds for staleness. But we don't know:
- What's the actual decay rate of infrastructure facts? (Days? Months? Years?)
- Do different knowledge types decay at different rates? (Facts fast, patterns slow?)
- Should decay rates be configurable per area?
- What does "stale" actually mean in practice — does anyone go back and re-verify?

### Scale of context injection across areas

With 17 areas, Tier 2 scoring is manageable. With 50+ areas, each scored against every turn's signals, the overhead grows. FTS5 is fast for querying, but the scoring algorithm runs area-level aggregation on top. At what area count does this become a bottleneck? We don't know because we haven't profiled it.

### Pi extension API stability

Pi is actively developed (version 0.58.x). The extension API may change:
- Event names could be renamed
- Handler signatures could change
- New events could replace existing ones
- `registerTool` interface could evolve

We're building on an API that's pre-1.0. Breaking changes are possible. Mitigation: we have the Pi source code and can fork if needed, but tracking upstream is maintenance work.

### The AI as knowledge curator

The background observer (Phase 2) will use a cheap LLM to decide what to capture. But:
- Will cheap models make good curation decisions?
- Will they over-capture (noise) or under-capture (missed knowledge)?
- Will they correctly identify which area a fact belongs to?
- Will they produce well-written facts or garbage that needs manual cleanup?

We're deferring this to Phase 2, which is correct — but it's the core value proposition of mykb (zero-friction capture). If it doesn't work well, the system degrades to manual capture, which is what OSB v1 already does.

---

## Validation Priority

Based on this analysis, the highest-risk unknowns that should be validated earliest:

| Priority | Risk | Status | Result |
|----------|------|--------|--------|
| 1 | Pi `context` event works for knowledge injection | **VALIDATED** | Spike 01 PASS — AI answers from injected `<mykb-context>` block. Tested via vfa with z.ai provider. ~4s latency, ~$0.0006/query. |
| 2 | `tool_call` blocking redirects the AI correctly | **VALIDATED** | Spike 02 PASS — AI gets blocked, reads the reason, switches to `kb_add` tool. Gotcha: property is `event.toolName` not `event.tool` (camelCase). |
| 3 | `better-sqlite3` works inside Pi packages | **VALIDATED** | Spike 03 PASS — native module loads in Pi container (Node.js 20 on both host and container). FTS5 available and queries work. |
| 4 | FTS5 BM25 matching is accurate enough | **PARTIALLY VALIDATED** | FTS5 works but is keyword-exact — "database" doesn't match "PostgreSQL". Need supplementary matching (area tags, synonyms) for broader recall. |
| 5 | Context injection doesn't degrade reasoning | TODO | A/B test needed with real workloads |
| 6 | Different providers handle injected context consistently | TODO | Only tested with z.ai (GLM). Need Anthropic, OpenAI, Google. |
| 7 | Auto-area-creation UX (sprawl risk) | TODO | Prototype and observe in real usage |
