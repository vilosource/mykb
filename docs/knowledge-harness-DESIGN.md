# Knowledge Harness Design

## Problem

mykb's knowledge delivery works well inside Pi — the extension auto-injects relevant facts, gates tool use, and manages session lifecycle through Pi's in-process event model. But when running inside a vfa container with Claude Code (or Gemini), the Pi extension is not available. Each runtime has a different hook mechanism with different capabilities:

- Pi has rich in-process hooks with shared state, signal accumulation, and direct context injection
- Claude Code has shell-command hooks with nudge-based delivery but also unique capabilities (LLM-evaluated hooks, compaction recovery, stop control)
- Gemini has minimal hooks (session end, pre-compress only)

Building separate hook implementations per runtime would duplicate logic and diverge over time. But flattening everything to the lowest common denominator would sacrifice Pi's automatic injection and Claude Code's behavioral enforcement.

We need a **unified hook system** that:
1. Shares logic across runtimes — one place to add a nudge or check
2. Preserves each runtime's strengths — Pi's injection, Claude Code's enforcement
3. Adapts delivery mode to the runtime — inject when possible, nudge when not

## Design Principles

1. **Single interface, runtime-aware behavior.** `kb hook <event>` is the entry point for all hook logic. The runtime determines the delivery mode (inject vs nudge), not the hook logic itself.

2. **Common foundation shared across all runtimes.** Area matching, tool gating, workspace loading, save triggers — these work the same everywhere. The logic lives in `src/hooks/` and is called by both Pi (in-process) and Claude Code (compiled binary).

3. **Runtime-specific capabilities preserved.** Pi's per-turn signal scoring is not diminished to match Claude Code's per-prompt matching. Claude Code's LLM hooks are not ignored because Pi can't do them. Each runtime uses its full capabilities.

4. **Hooks are nudges in Claude Code, enforcement in Pi.** In Claude Code, hooks suggest via `systemMessage` and the AI decides. In Pi, hooks inject directly and gate tools. The same `kb hook` call returns different output depending on the runtime.

5. **CLI-powered logic is adapter-agnostic.** The `kb match`, `kb check-*` commands work from any shell. The hook scripts are thin callers of these commands.

## Solution

### Architecture

```
src/hooks/                         ← Shared hook logic (TypeScript)
  session-start.ts                 ← Load workspace + area index
  user-prompt.ts                   ← Match prompt against areas
  pre-tool-use.ts                  ← Gate brain file writes
  post-tool-use.ts                 ← Impact check, capture nudges
  stop.ts                          ← Journal reminder
  session-end.ts                   ← Auto-save
  context.ts                       ← Signal scoring + entry selection (Pi-enhanced)

src/cli/hook.ts                    ← CLI: `kb hook <event> [--format claude|pi]`
src/extension/index.ts             ← Pi: calls src/hooks/* in-process

Build:
  bun build --compile src/cli/hook.ts → kb-hook binary (~50ms startup)
```

### How each runtime uses it

**Pi extension (in-process, full capability):**
- Calls `src/hooks/*` functions directly — no process spawn, no serialization
- Has shared `SessionState` for signal accumulation across turns
- `context` event calls `context.ts` with accumulated signals → returns entries for injection
- `tool_call` event calls `pre-tool-use.ts` → returns block/allow
- `before_agent_start` calls `session-start.ts` → mutates system prompt directly

**Claude Code (compiled binary, nudge-based):**
- `hooks.json` wires events to `kb-hook <event> --format claude`
- Binary reads event JSON from stdin, runs shared hook logic, outputs `systemMessage` JSON
- Compiled via `bun build --compile` for fast startup (~50ms vs ~85ms Node.js)
- Hooks suggest actions; the AI decides whether to follow

**Gemini (minimal, shell-based):**
- Session end hook calls `kb-hook session-end --format gemini`
- Limited hook surface — only lifecycle events available

## Capability Tables

### Common Foundation (all runtimes)

These hooks use the same logic everywhere. The delivery mechanism differs but the behavior is equivalent.

| Hook | What it does | Trigger |
|------|-------------|---------|
| Session start context | Load active workspace state + area index, inject into AI context | Session begins |
| Tool gating | Block direct writes to brain `.jsonl`/`area.json`/`manifest.json`, redirect to `kb add` | Before Edit/Write tool |
| Area matching (prompt) | Match user's prompt against area summaries, suggest loading relevant areas | User submits prompt |
| Area matching (command) | Match bash command against area summaries, suggest relevant knowledge | Before Bash tool |
| Session dedup | Track suggested areas per session to avoid nagging | Across all matching hooks |
| Auto-save | Commit brain changes to git | Session ends |
| Error→fix capture | Detect fail→success bash exit code transition, suggest adding gotcha | After Bash tool |
| Save reminder | Periodic reminder to journal progress (every N commands) | After Bash tool |

### Pi-Only Capabilities

These leverage Pi's in-process extension model. Cannot be replicated in Claude Code's shell-command hooks.

| Capability | What it does | Why Pi-only |
|-----------|-------------|-------------|
| Per-turn automatic context injection | Scores accumulated signals against areas every turn, selects entries within 2000-token budget, injects as system message | Requires `context` event (per-turn with message history) and in-process signal state |
| Signal accumulation across turns | Collects file path signals from tool_call, keyword signals from tool_result + input, aggregates across turns for scoring | Requires shared in-process `SessionState` across events |
| Workspace-aware scoring boost | Areas linked to active workspace get +0.5 score boost during context scoring | Part of the in-process scoring pipeline |
| Native tool registration | `kb_add`, `kb_search`, `kb_load`, `kb_list`, `kb_work_*` as first-class Pi tools with structured input/output | Pi extension API `registerTool()` |
| Direct system prompt mutation | Appends area index + workspace state directly to system prompt at session start | Pi's `before_agent_start` returns modified `systemPrompt` |
| `/kb` command | On-demand area loading via registered command with `ctx.inject()` for direct context injection | Pi extension API `registerCommand()` |
| Signal providers | Pluggable scoring providers (KeywordSignalProvider, FilePathSignalProvider) with extensible interface | In-process scoring architecture |

### Claude Code-Only Capabilities

These leverage Claude Code's hook system features that Pi doesn't have.

| Capability | What it does | Why Claude Code-only |
|-----------|-------------|---------------------|
| Compaction re-injection | Re-inject workspace state + area index after context compaction | `SessionStart` fires with `compact` matcher — Pi has no compaction event |
| Stop hook continuation | Force Claude to continue working if journal wasn't written | `Stop` event with `decision: "block"` — Pi can't intercept agent stopping |
| LLM-evaluated hooks | Use a second model (Haiku) to evaluate conditions that need judgment | `type: "prompt"` and `type: "agent"` hook types — Pi has no equivalent |
| PreCompact checkpoint | Journal progress + save before compaction to prevent context loss | `PreCompact` event — Pi has no equivalent |
| Post-failure context | Inject additional context after a tool call fails | `PostToolUseFailure` event — Pi has no equivalent |
| Richer event surface | 18+ hook events covering subagents, config changes, worktrees, permissions, elicitation | Claude Code's extensive hook system vs Pi's 7 events |
| Agent-based verification | Spawn a subagent with tool access to verify conditions (e.g., run tests before stopping) | `type: "agent"` hooks — multi-turn verification |

## Hook Catalog

### Priority 1: Foundation

| # | Hook | Event | Capability tier | Runtime behavior |
|---|------|-------|----------------|-----------------|
| H1 | Session start context | SessionStart / before_agent_start | Common | Pi: mutate system prompt. Claude: `systemMessage` |
| H2 | Tool gating | PreToolUse / tool_call | Common | Both: block with reason |
| H3 | Auto-save | SessionEnd / session_shutdown | Common | Both: `kb save` |

### Priority 2: Area Matching

| # | Hook | Event | Capability tier | Runtime behavior |
|---|------|-------|----------------|-----------------|
| H4 | Prompt matching | UserPromptSubmit / input | Common | Pi: add to signals. Claude: nudge with area suggestions |
| H5 | Command matching | PreToolUse(Bash) / tool_call | Common | Pi: add to signals. Claude: nudge with area suggestions |
| H6 | Context injection | context | **Pi-only** | Pi: score signals → select entries → inject. Claude: N/A |

### Priority 3: Capture Nudges

| # | Hook | Event | Capability tier | Runtime behavior |
|---|------|-------|----------------|-----------------|
| H7 | Error→fix gotcha | PostToolUse(Bash) / tool_result | Common | Both: nudge to add gotcha |
| H8 | Save reminder | PostToolUse(Bash) | Common | Both: periodic nudge |
| H9 | Impact check on edit | PostToolUse(Edit\|Write) | Common | Both: nudge if edited file impacts known facts |
| H10 | Stale citation check | PostToolUse(Read) | Common | Both: nudge if read file has stale citations |

### Priority 4: Behavioral Enforcement

| # | Hook | Event | Capability tier | Runtime behavior |
|---|------|-------|----------------|-----------------|
| H11 | Journal reminder | Stop | **Claude Code-only** | Force continuation if significant work done without journaling |
| H12 | Compaction checkpoint | PreCompact | **Claude Code-only** | Journal + save before context compaction |
| H13 | Compaction recovery | SessionStart(compact) | **Claude Code-only** | Re-inject workspace state after compaction |

### Priority 5: Provenance (future)

| # | Hook | Event | Capability tier | Runtime behavior |
|---|------|-------|----------------|-----------------|
| H14 | Conflict detection | PostToolUse(Bash) after kb add | Common | Both: warn if new fact conflicts with existing |
| H15 | Structured output extraction | PostToolUse(Bash) | Common | Both: detect JSON/YAML/HCL, suggest extraction |

## Per-Runtime Delivery

### Claude Code

`hooks.json` wired into the vfa profile:

```json
{
  "SessionStart": [
    {"matcher": "startup|resume|compact",
     "hooks": [{"type": "command", "command": "kb-hook session-start --format claude"}]}
  ],
  "UserPromptSubmit": [
    {"matcher": "",
     "hooks": [{"type": "command", "command": "kb-hook user-prompt --format claude"}]}
  ],
  "PreToolUse": [
    {"matcher": "Edit|Write",
     "hooks": [{"type": "command", "command": "kb-hook pre-tool-use --format claude"}]},
    {"matcher": "Bash",
     "hooks": [{"type": "command", "command": "kb-hook pre-bash --format claude"}]}
  ],
  "PostToolUse": [
    {"matcher": "Bash",
     "hooks": [{"type": "command", "command": "kb-hook post-bash --format claude"}]},
    {"matcher": "Edit|Write",
     "hooks": [{"type": "command", "command": "kb-hook post-edit --format claude"}]},
    {"matcher": "Read",
     "hooks": [{"type": "command", "command": "kb-hook post-read --format claude"}]}
  ],
  "Stop": [
    {"hooks": [{"type": "prompt",
     "prompt": "Check if significant work was done but no 'kb work journal' was called. If so, respond with {\"ok\": false, \"reason\": \"Please journal progress: kb work journal '<summary>'\"}. Otherwise {\"ok\": true}."}]}
  ],
  "PreCompact": [
    {"hooks": [{"type": "command", "command": "kb-hook pre-compact --format claude"}]}
  ],
  "SessionEnd": [
    {"matcher": "",
     "hooks": [{"type": "command", "command": "kb-hook session-end --format claude", "timeout": 5}]}
  ]
}
```

### Pi Extension

The Pi extension (`src/extension/index.ts`) calls `src/hooks/*` directly:

```typescript
// Common hooks — shared logic
pi.on('before_agent_start', (event, ctx) => {
  return sessionStart(store, state, brainPath, wsStorage, event);
});

pi.on('tool_call', (event, ctx) => {
  // Common: tool gating
  const gating = preToolUse(brainPath, event);
  if (gating) return gating;
  // Pi-only: signal collection
  collectSignals(state, event);
});

// Pi-only — not available in Claude Code
pi.on('context', (messages) => {
  return contextInjection(store, state, brainPath, messages);
});

pi.on('tool_result', (event) => collectResultSignals(state, event));
pi.on('input', (event) => collectInputSignals(state, event));

// Common hooks
pi.on('session_shutdown', () => sessionEnd(brainPath));
pi.registerCommand('kb', kbCommandHandler(store, state));
registerTools(pi, store, brainPath, wsStorage);
```

## Packaging

The `kb-hook` binary and `hooks.json` are **profile-scoped** — they belong to the kb profile, not to vfa or Claude Code globally.

**Build:** `bun build --compile src/cli/hook.ts --outfile dist/kb-hook`

**Container delivery:** vfa mounts the binary and hooks.json into the container as part of the kb profile's instruction assembly. The profile declares that it needs hooks; vfa wires them for the runtime.

**Pi delivery:** The mykb npm package includes the extension. No binary needed — hooks run in-process.

## Refactoring Required

The current Pi extension has hook logic embedded in `src/extension/hooks/*.ts`. This needs extraction:

| Current location | Move to | Why |
|-----------------|---------|-----|
| `src/extension/hooks/session.ts` (workspace + area index loading) | `src/hooks/session-start.ts` | Shared by Pi + Claude Code |
| `src/extension/hooks/context.ts` (signal scoring + injection) | `src/hooks/context.ts` | Pi-only but should live in shared hooks for consistency |
| `src/extension/hooks/tool-gating.ts` (brain file protection) | `src/hooks/pre-tool-use.ts` | Shared by Pi + Claude Code |
| `src/extension/hooks/signals.ts` (signal collection) | `src/hooks/signals.ts` | Pi-only but part of the hook system |
| `src/extension/scorer.ts` (area scoring) | `src/hooks/scorer.ts` | Used by context injection and area matching |
| N/A (new) | `src/hooks/post-bash.ts` | Claude Code capture nudges (error→fix, save reminder) |
| N/A (new) | `src/hooks/post-edit.ts` | Impact check on edit |
| N/A (new) | `src/hooks/post-read.ts` | Stale citation check |

The Pi extension becomes a thin adapter that imports from `src/hooks/` and registers on Pi events.

## Dependencies

| Component | Status | Needed for |
|-----------|--------|-----------|
| `src/hooks/` shared layer | **Needs building** (extract from Pi extension) | All hooks |
| `kb hook <event>` CLI command | **Needs building** | Claude Code delivery |
| `bun build --compile` pipeline | **Needs building** | Fast binary for containers |
| `kb match <text> --json` | **Needs building** (expose scorer as CLI) | H4, H5 (area matching) |
| `kb check-impact <path> --json` | **Needs building** | H9 (impact check) |
| `kb check-citation <path> --json` | **Needs building** | H10 (stale citation) |
| Profile-scoped hook wiring in vfa | **Needs building** | Container delivery |
| `kb work list`, `kb work show`, `kb list`, `kb load`, `kb save` | **Exists** | H1, H3 |

## Implementation Phases

### Phase 1: Foundation (H1 + H2 + H3)

Extract shared hook logic from Pi extension. Build `kb hook` CLI command and bun compile pipeline. Implement session start, tool gating, auto-save. Wire into vfa kb profile for Claude Code.

### Phase 2: Area Matching (H4 + H5)

Build `kb match <text> --json` command. Implement prompt and command matching with session dedup. Wire into UserPromptSubmit and PreToolUse(Bash).

### Phase 3: Capture Nudges (H7 + H8)

Implement error→fix detection and periodic save reminders in post-bash handler. Temp-file state for exit code tracking and command counting.

### Phase 4: Behavioral Enforcement (H11 + H12 + H13)

Claude Code-only: Stop hook journal reminder (prompt type), PreCompact checkpoint, compaction re-injection.

### Phase 5: Provenance (H9 + H10 + H14 + H15)

Build `kb check-impact` and `kb check-citation`. Implement impact check on edit, stale citation on read, conflict detection, structured output extraction.

## Open Questions

1. **Hook binary name** — `kb-hook` (separate binary) or `kb hook` (subcommand of existing kb CLI)? Separate binary means bun compiles just the hook logic. Subcommand means the full kb CLI is compiled (larger binary, but one tool).

2. **Session state in Claude Code** — Temp files (`/tmp/kb-*-$session_id`) for dedup and counters, following the OSB pattern? Or a more structured approach?

3. **Brain path detection** — Hardcode `/home/node/.mykb/brain/` for containers? Use `$MYKB_DIR`? Auto-detect?

4. **Hooks.json delivery** — Should vfa generate `hooks.json` dynamically based on the profile and runtime? Or ship a static `hooks.json` per profile?

5. **Pi extension refactor scope** — Extract hooks to `src/hooks/` in the same PR as building `kb hook`, or as a separate preparatory refactor?
