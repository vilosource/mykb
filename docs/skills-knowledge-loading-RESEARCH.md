# Dynamic Skills & Knowledge Loading — Research Report

Date: 2026-03-15

## The Concern

Claude Code skills are automatic — descriptions are injected into the system prompt, the AI matches intent naturally, and skill content loads on demand. Does Pi have this? If not, how do we achieve the same behavior for mykb knowledge loading?

---

## Finding 1: Pi DOES have automatic skill loading

Pi follows the same **Agent Skills standard** (SKILL.md) as Claude Code. The mechanism is nearly identical:

**At startup:**
Pi scans skill directories and injects an `<available_skills>` XML block into the system prompt:

```xml
<available_skills>
  <skill>
    <name>brave-search</name>
    <description>Search the web using Brave Search API...</description>
    <location>/home/user/.pi/agent/skills/brave-search/SKILL.md</location>
  </skill>
</available_skills>
```

**At runtime:**
The AI matches user intent against descriptions and uses the `read` tool to load the full SKILL.md content. This is the same progressive disclosure pattern as Claude Code.

**Skill discovery locations:**
- `~/.pi/agent/skills/` (global)
- `~/.agents/skills/` (cross-agent standard)
- `.pi/skills/` (project-local)
- `.agents/skills/` (project-local, walks up to git root)
- Pi Packages (npm/git installed)
- `--skill <path>` CLI flag
- `settings.json` arrays

So the base behavior is **feature-parity with Claude Code** for skills.

## Finding 2: The reliability problem — skills don't always fire

This is the critical concern. Vercel's evaluation found:

| Approach | Pass Rate |
|----------|-----------|
| Baseline (no docs) | 53% |
| Skills (default descriptions) | 53% (+0pp) |
| Skills (with explicit instructions) | 79% (+26pp) |
| AGENTS.md (always-loaded) | **100%** (+47pp) |

Key quotes:
- **"In 56% of eval cases, the skill was never invoked"**
- "Small wording tweaks produce large behavioral swings" in skill invocation

This is not a Pi problem or a Claude Code problem — it's an **LLM behavior problem**. The AI decides which skills to use through natural language reasoning, not algorithmic matching. And it often decides not to.

Source: [Vercel — AGENTS.md Outperforms Skills in Our Agent Evals](https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals)

## Finding 3: Always-loaded context beats on-demand loading

Vercel's finding that AGENTS.md (always-loaded) achieves 100% while skills (on-demand) achieve 53-79% has a direct implication:

**For critical knowledge that the AI must have, passive injection beats progressive disclosure.**

This doesn't mean we should dump everything into the system prompt. Vercel compressed 40KB of docs to 8KB (80% reduction) while maintaining 100% pass rate. The strategy is:

- **Always loaded:** Compact summaries and critical facts (the index)
- **On demand:** Full detail when the AI needs to go deeper

## Finding 4: Pi has MORE tools to solve this than Claude Code

Where Claude Code is stuck with "inject description, hope for the best," Pi provides multiple hooks to build reliable dynamic loading:

### Pi's `input` event — intercept and match before the AI sees it

```typescript
pi.on("input", async (event, ctx) => {
  const matched = matchAreasToInput(event.text, areaIndex);
  if (matched.length > 0) {
    const facts = loadRelevantFacts(matched);
    return { action: "transform", text: `${facts}\n\n${event.text}` };
  }
  return { action: "continue" };
});
```

This runs BEFORE the AI processes the input. Not a suggestion — a transformation. The AI sees the enriched input with relevant knowledge already included.

### Pi's `before_agent_start` event — inject per-turn context

```typescript
pi.on("before_agent_start", async (event, ctx) => {
  return {
    message: {
      customType: "mykb-knowledge",
      content: formatKnowledgeForTurn(event.prompt),
      display: false,
    },
    systemPrompt: event.systemPrompt + formatAreaIndex(areaIndex),
  };
});
```

This injects a persistent message AND modifies the system prompt for each turn. The knowledge is there — the AI doesn't need to decide to load it.

### Pi's `context` event — modify message history before each LLM call

```typescript
pi.on("context", async (event, ctx) => {
  const relevantFacts = detectRelevantKnowledge(event.messages);
  const knowledgeMessage = createKnowledgeMessage(relevantFacts);
  return { messages: [knowledgeMessage, ...event.messages] };
});
```

This is the most powerful — it modifies the actual message array that goes to the LLM. The extension analyzes the full conversation, determines what knowledge is relevant, and injects it. The AI cannot ignore it because it's part of the message history, not a suggestion.

### Pi's `tool_result` event — watch and learn passively

```typescript
pi.on("tool_result", async (event, ctx) => {
  if (event.toolName === "read" && isInfraFile(event.result)) {
    queueKnowledgeForNextTurn("infra-iac");
  }
});
```

This watches what the AI is doing and pre-loads knowledge for the next turn. Zero friction, zero distraction.

## Finding 5: The three-tier knowledge strategy

Based on this research, the optimal approach combines three tiers:

### Tier 1: Always loaded (system prompt)
- Area index (ID + one-line summary for each area)
- Critical active facts (compact form)

This is the "AGENTS.md approach" — always there, always reliable. Kept small (<8KB based on Vercel's findings).

### Tier 2: Context-injected (automatic, per-turn)
- Relevant area facts based on what the AI is working on
- Loaded via `context` or `before_agent_start` events
- Extension decides what's relevant — not the AI, not the user
- Triggered by file paths, command patterns, conversation content

This is the capability Pi enables that Claude Code cannot do. Not a nudge, not a skill to invoke — automatic context enrichment.

### Tier 3: On-demand (explicit)
- Full area deep-dives via `/kb <area>` command
- Detailed decision logs, extended reference material
- Loaded when the user or AI explicitly requests it

This is traditional progressive disclosure — still useful for deep exploration, but not relied upon for critical knowledge.

## Finding 6: Ecosystem trends

### Agent Skills standard (cross-agent)
The SKILL.md format is now an open standard adopted by Claude Code, Pi, GitHub Copilot, Cursor, and OpenAI Codex. mykb skills would be portable across agents if we follow this standard.

### Harness engineering (2026 trend)
The concept of "harness engineering" has emerged, focusing on:
- Automated memory systems accumulating project-specific knowledge across sessions
- Three-tier context infrastructure: hot memory, domain experts, cold-memory knowledge
- Event-driven system reminders to counteract instruction fade-out

### Passive context superiority
Multiple sources confirm: always-loaded context outperforms on-demand loading. The industry is moving toward "smart passive context" — small, curated, always-present knowledge — over "load everything on demand."

---

## Implications for mykb

1. **Pi has feature-parity with Claude Code on skills.** The concern that Pi can't do automatic skill matching is unfounded — it uses the same Agent Skills standard.

2. **But automatic matching is unreliable in BOTH harnesses.** The real problem is LLM behavior, not the harness. Skills/nudges get ignored 50%+ of the time.

3. **Pi's advantage is enforcement.** Where Claude Code can only suggest (system prompt injection + hope), Pi can **inject knowledge directly into the message stream** via `context`, `before_agent_start`, and `input` events. The AI cannot ignore knowledge that's part of its message history.

4. **The three-tier strategy is the path forward:**
   - Tier 1 (always loaded): area index in system prompt
   - Tier 2 (auto-injected): relevant facts via `context` event — the AI has knowledge without asking
   - Tier 3 (on-demand): deep dives via `/kb` command

5. **The "knowledge as skills" insight is validated.** The mechanism is identical — lightweight index → match → inject content. But Pi lets us move from "suggest the AI loads it" (unreliable) to "inject it into context" (reliable).

---

## Sources

- [Pi Skills Documentation](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/skills.md)
- [Pi Extensions Documentation](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md)
- [Pi SDK Documentation](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/sdk.md)
- [Vercel — AGENTS.md Outperforms Skills in Our Agent Evals](https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals)
- [Claude Agent Skills: A First Principles Deep Dive](https://leehanchung.github.io/blogs/2025/10/26/claude-skills-deep-dive/)
- [Mario Zechner — What I learned building a coding agent](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/)
- [Pi vs Claude Code Comparison](https://github.com/disler/pi-vs-claude-code)
- [The Three Kingdoms of CLI Coding Agents](https://yun123.io/en/blog/cli-coding-agents-comparison/)
- [Agent Skills: How is it different from commands and other tools?](https://kau.sh/blog/claude-skills/)
