# Knowledge Harness Design

## Problem

mykb's knowledge delivery works well inside Pi — the extension auto-injects relevant facts, gates tool use, and manages session lifecycle through Pi's in-process event model. But when running inside a vfa container with Claude Code or Gemini CLI, the Pi extension is not available.

Each runtime has a different hook mechanism with different strengths:

- **Pi** has in-process hooks with shared state, signal accumulation, and direct context injection — the richest automatic knowledge delivery
- **Claude Code** has shell-command hooks with LLM-evaluated hooks, compaction recovery, and stop control — the strongest behavioral enforcement
- **Gemini CLI** has shell-command hooks with LLM request/response interception, tool selection control, and response retry — the deepest model-level integration

Building separate implementations per runtime would duplicate logic and diverge over time. Flattening everything to the lowest common denominator would sacrifice each runtime's unique strengths.

We need a **unified hook system** that:
1. Shares logic across runtimes — one place to add a hook or check
2. Preserves each runtime's strengths — no runtime is diminished
3. Adapts delivery mode to the runtime — inject, nudge, or intercept depending on what's available

## Design Principles

1. **Single interface, runtime-aware behavior.** `kb hook <event>` is the entry point for all hook logic. The runtime determines the delivery mode, not the hook logic itself.

2. **Common foundation shared across all runtimes.** Area matching, tool gating, workspace loading, save triggers — these work the same everywhere. The logic lives in `src/hooks/` and is called by all runtimes.

3. **Runtime-specific capabilities preserved.** Pi's per-turn signal scoring is not diminished to match Claude Code's per-prompt matching. Gemini's BeforeModel injection is not ignored because Pi can't do it. Each runtime uses its full capabilities.

4. **Delivery mode adapts to the runtime:**
   - **Pi** — in-process injection and enforcement (strongest delivery)
   - **Claude Code** — nudges via `systemMessage`, enforcement via stop/prompt hooks
   - **Gemini CLI** — nudges via `systemMessage`, injection via `BeforeModel` message manipulation, enforcement via `AfterAgent` retry

5. **CLI-powered logic is adapter-agnostic.** The `kb match`, `kb check-*` commands work from any shell. Hook scripts are thin callers.

## Runtime Hook Systems

### Pi Extension API

7 events, in-process TypeScript, shared state across events.

| Event | When it fires | Can inject? | Can block? |
|-------|--------------|------------|-----------|
| `session_start` | Session begins | No (init only) | No |
| `before_agent_start` | Before first turn | Yes — mutate system prompt | No |
| `context` | Every turn, with message history | Yes — prepend system message | No |
| `tool_call` | Before tool execution | No | Yes — return `{block, reason}` |
| `tool_result` | After tool execution | No (signal collection) | No |
| `input` | User text submitted | No (signal collection) | No |
| `session_shutdown` | Session ends | No | No |

Additional: `registerTool()` for native tools, `registerCommand()` for `/kb` command.

### Claude Code Hook System

18+ events, shell commands or LLM-evaluated, JSON stdin/stdout.

| Event | When it fires | Can inject? | Can block? |
|-------|--------------|------------|-----------|
| `SessionStart` | Session begins/resumes/compaction | Yes — `additionalContext` or stdout | No |
| `UserPromptSubmit` | User submits prompt | Yes — `additionalContext` | Yes — `decision: "block"` |
| `PreToolUse` | Before tool execution | Yes — `additionalContext` | Yes — `permissionDecision: "deny"` |
| `PostToolUse` | After tool succeeds | Yes — `additionalContext` | No |
| `PostToolUseFailure` | After tool fails | Yes — `additionalContext` | No |
| `Stop` | Agent finishes responding | Yes — force continuation | Yes — `decision: "block"` |
| `PreCompact` | Before compaction | Yes | No |
| `PostCompact` | After compaction | Yes | No |
| `SessionEnd` | Session terminates | No (cleanup) | No |
| `PermissionRequest` | Permission dialog shown | No | Yes — allow/deny |
| `SubagentStart/Stop` | Subagent lifecycle | Yes — `additionalContext` | No |
| `ConfigChange` | Config file modified | No | Yes — `decision: "block"` |

Hook types: `command` (shell), `prompt` (single LLM call), `agent` (multi-turn LLM with tools), `http` (webhook).

### Gemini CLI Hook System

11 events, shell commands, JSON stdin/stdout.

| Event | When it fires | Can inject? | Can block? |
|-------|--------------|------------|-----------|
| `SessionStart` | Session begins/resumes/clear | Yes — `additionalContext` | No |
| `SessionEnd` | Session terminates | No (cleanup) | No |
| `BeforeAgent` | User submits prompt, before planning | Yes — `additionalContext` | Yes — `decision: "deny"` |
| `AfterAgent` | Agent finishes responding | No | Yes — `decision: "deny"` forces retry with `reason` as correction |
| `BeforeTool` | Before tool execution | Yes — modify `tool_input` | Yes — `decision: "deny"` |
| `AfterTool` | After tool execution | Yes — `additionalContext`, tail calls | Yes — replace result |
| `BeforeModel` | Before LLM API call | Yes — modify messages, model, config | Yes — synthetic response (skip LLM) |
| `AfterModel` | After LLM response chunk | Yes — modify response | Yes — block chunk |
| `BeforeToolSelection` | Before LLM decides tools | No | Yes — filter tools, force mode |
| `Notification` | System alert | No (observability) | No |
| `PreCompress` | Before compression | No (advisory) | No |

Hook types: `command` (shell) only currently. Extensions can include `hooks/hooks.json`.

## Solution

### Architecture

```
src/hooks/                         ← Shared hook logic (TypeScript)
  session-start.ts                 ← Load workspace + area index
  user-prompt.ts                   ← Match prompt against areas
  pre-tool-use.ts                  ← Gate brain file writes
  post-tool-use.ts                 ← Impact check, capture nudges
  stop.ts                          ← Journal reminder check
  session-end.ts                   ← Auto-save
  context.ts                       ← Signal scoring + entry selection (Pi-enhanced)
  scorer.ts                        ← Area scoring (shared by context + matching)
  signals.ts                       ← Signal collection (Pi-enhanced)

src/cli/hook.ts                    ← CLI: `kb hook <event> [--format claude|gemini|pi]`
src/extension/index.ts             ← Pi: calls src/hooks/* in-process

Build:
  bun build --compile src/cli/hook.ts → kb-hook binary (~50ms startup)
```

### How each runtime uses it

**Pi extension (in-process, full capability):**
- Calls `src/hooks/*` functions directly — no process spawn
- Shared `SessionState` for signal accumulation across turns
- `context` event calls `context.ts` → returns entries for injection
- `before_agent_start` calls `session-start.ts` → mutates system prompt
- Registers native tools via Pi API

**Claude Code (compiled binary, nudge + enforcement):**
- `hooks.json` wires events to `kb-hook <event> --format claude`
- Binary reads event JSON from stdin, runs shared logic, outputs formatted JSON
- Nudges via `systemMessage`, enforcement via `Stop` prompt hooks
- Compaction recovery via `SessionStart(compact)` re-injection

**Gemini CLI (compiled binary, nudge + interception):**
- `hooks.json` wires events to `kb-hook <event> --format gemini`
- Same binary, different output format
- Nudges via `systemMessage`, injection via `BeforeModel` message array
- Enforcement via `AfterAgent` retry and `BeforeToolSelection` filtering

## Capability Tables

### Common Foundation (all runtimes)

| Hook | What it does | Pi event | Claude Code event | Gemini event |
|------|-------------|----------|------------------|-------------|
| Session start context | Load workspace state + area index, inject into context | `before_agent_start` | `SessionStart` | `SessionStart` |
| Tool gating | Block direct writes to brain files, redirect to `kb add` | `tool_call` | `PreToolUse(Edit\|Write)` | `BeforeTool(replace\|write_file)` |
| Area matching (prompt) | Match user prompt against areas, suggest loading | `input` (signal) | `UserPromptSubmit` | `BeforeAgent` |
| Area matching (command) | Match shell command against areas | `tool_call` (signal) | `PreToolUse(Bash)` | `BeforeTool(run_shell_command)` |
| Session dedup | Track suggested areas per session | In-process state | Temp files | Temp files |
| Auto-save | Commit brain to git | `session_shutdown` | `SessionEnd` | `SessionEnd` |
| Error→fix capture | Detect fail→success transition, suggest gotcha | `tool_result` | `PostToolUse(Bash)` | `AfterTool(run_shell_command)` |
| Save reminder | Periodic reminder to journal | Counter in state | Counter in temp file | Counter in temp file |

### Pi-Only Capabilities

| Capability | What it does | Why Pi-only |
|-----------|-------------|-------------|
| Per-turn context injection | Scores accumulated signals, selects entries within token budget, injects as system message every turn | Requires `context` event with message history and in-process signal state |
| Signal accumulation | Collects file path + keyword signals across turns, aggregates for scoring | Requires shared in-process `SessionState` |
| Workspace-aware scoring boost | +0.5 boost to areas linked to active workspace | Part of in-process scoring pipeline |
| Native tool registration | `kb_add`, `kb_search`, `kb_load`, `kb_list`, `kb_work_*` as first-class tools | Pi `registerTool()` API |
| Direct system prompt mutation | Appends to system prompt at session start | `before_agent_start` returns modified prompt |
| `/kb` command | On-demand area loading with `ctx.inject()` | Pi `registerCommand()` API |
| Pluggable signal providers | Extensible `SignalProvider` interface for custom scoring | In-process architecture |

### Claude Code-Only Capabilities

| Capability | What it does | Why Claude Code-only |
|-----------|-------------|---------------------|
| Compaction re-injection | Re-inject context after compaction | `SessionStart` fires on `compact` — no other runtime has this |
| Stop continuation | Force agent to keep working if journal not written | `Stop` with `decision: "block"` — Pi/Gemini can't intercept stopping |
| LLM-evaluated hooks | Use Haiku to evaluate conditions needing judgment | `type: "prompt"` hooks — Gemini/Pi have no equivalent |
| Agent-based verification | Spawn subagent with tool access to verify conditions | `type: "agent"` hooks — multi-turn verification |
| PreCompact checkpoint | Journal + save before compaction | `PreCompact` event |
| Post-failure context | Inject context after tool failure | `PostToolUseFailure` event |
| Subagent context | Inject context when subagents spawn | `SubagentStart` event |

### Gemini-Only Capabilities

| Capability | What it does | Why Gemini-only |
|-----------|-------------|----------------|
| BeforeModel message injection | Modify the LLM request messages array before sending — can inject knowledge directly into what the model sees | `BeforeModel` event — neither Pi nor Claude Code can intercept the LLM request |
| Tool selection control | Filter available tools or force tool mode (ANY/NONE) | `BeforeToolSelection` — could force `kb add` when in capture mode |
| AfterAgent retry | Reject agent response and force retry with correction prompt | `AfterAgent` with `decision: "deny"` + `reason` — Claude Code's `Stop` can continue but can't correct |
| Synthetic response | Skip the LLM call entirely, return a cached/precomputed response | `BeforeModel` with `llm_response` — could serve cached knowledge |
| Response chunk modification | Intercept and modify LLM response in real-time during streaming | `AfterModel` — real-time PII filtering or response transformation |
| Tool result replacement | Replace a tool's result before the agent sees it | `AfterTool` with `decision: "deny"` — could enrich tool results with knowledge |
| Tail tool calls | Chain another tool call immediately after one completes | `AfterTool` with `tailToolCallRequest` — auto-chain `kb match` after file reads |

## Hook Catalog

### Priority 1: Foundation

| # | Hook | Common | Pi | Claude Code | Gemini |
|---|------|--------|-----|------------|--------|
| H1 | Session start context | Shared logic | `before_agent_start` → mutate prompt | `SessionStart` → `systemMessage` | `SessionStart` → `additionalContext` |
| H2 | Tool gating | Shared logic | `tool_call` → block | `PreToolUse` → deny | `BeforeTool` → deny |
| H3 | Auto-save | Shared logic | `session_shutdown` | `SessionEnd` | `SessionEnd` |

### Priority 2: Area Matching

| # | Hook | Common | Pi | Claude Code | Gemini |
|---|------|--------|-----|------------|--------|
| H4 | Prompt matching | Shared scorer | `input` → signal | `UserPromptSubmit` → nudge | `BeforeAgent` → nudge or `BeforeModel` → inject into messages |
| H5 | Command matching | Shared scorer | `tool_call` → signal | `PreToolUse(Bash)` → nudge | `BeforeTool(run_shell_command)` → nudge |
| H6 | Context injection | Shared scorer | `context` → inject entries | N/A | `BeforeModel` → inject into message array |

### Priority 3: Capture Nudges

| # | Hook | Common | Pi | Claude Code | Gemini |
|---|------|--------|-----|------------|--------|
| H7 | Error→fix gotcha | Shared logic | `tool_result` → nudge | `PostToolUse(Bash)` → nudge | `AfterTool(run_shell_command)` → nudge |
| H8 | Save reminder | Shared logic | Counter in state | Counter in temp file | Counter in temp file |
| H9 | Impact on edit | Shared logic | `tool_result` → nudge | `PostToolUse(Edit\|Write)` → nudge | `AfterTool(replace\|write_file)` → nudge |
| H10 | Stale citation | Shared logic | `tool_result` → nudge | `PostToolUse(Read)` → nudge | `AfterTool(read_file)` → nudge |

### Priority 4: Behavioral Enforcement

| # | Hook | Pi | Claude Code | Gemini |
|---|------|-----|------------|--------|
| H11 | Journal reminder | N/A | `Stop` → prompt hook forces continuation | `BeforeAgent` → nudge "haven't journaled yet" + `SessionEnd` best-effort auto-journal |
| H12 | Compaction checkpoint | N/A | `PreCompact` → journal + save | `PreCompress` → journal + save |
| H13 | Compaction recovery | N/A | `SessionStart(compact)` → re-inject context | `SessionStart(compress)` → re-inject context |
| H14 | Response quality check | N/A | N/A | `AfterAgent` → deny if response didn't use available knowledge |
| H15 | Knowledge-aware model request | N/A | N/A | `BeforeModel` → inject relevant entries into message array |

### Priority 5: Provenance (future)

| # | Hook | Common | All runtimes |
|---|------|--------|-------------|
| H16 | Conflict detection | Shared logic | Nudge after `kb add` if conflicting entry exists |
| H17 | Structured output extraction | Shared logic | Detect JSON/YAML/HCL in tool output, suggest extraction |
| H18 | Tool selection enforcement | N/A | Gemini-only: `BeforeToolSelection` to force `kb add` tool in capture mode |

## Per-Runtime Delivery

### Claude Code

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

### Gemini CLI

```json
{
  "SessionStart": [
    {"matcher": "startup|resume|compress",
     "hooks": [{"type": "command", "command": "kb-hook session-start --format gemini"}]}
  ],
  "BeforeAgent": [
    {"hooks": [{"type": "command", "command": "kb-hook user-prompt --format gemini"}]}
  ],
  "BeforeTool": [
    {"matcher": "replace|write_file",
     "hooks": [{"type": "command", "command": "kb-hook pre-tool-use --format gemini"}]},
    {"matcher": "run_shell_command",
     "hooks": [{"type": "command", "command": "kb-hook pre-bash --format gemini"}]}
  ],
  "AfterTool": [
    {"matcher": "run_shell_command",
     "hooks": [{"type": "command", "command": "kb-hook post-bash --format gemini"}]},
    {"matcher": "replace|write_file",
     "hooks": [{"type": "command", "command": "kb-hook post-edit --format gemini"}]},
    {"matcher": "read_file",
     "hooks": [{"type": "command", "command": "kb-hook post-read --format gemini"}]}
  ],
  "AfterAgent": [
    {"hooks": [{"type": "command", "command": "kb-hook after-agent --format gemini"}]}
  ],
  "BeforeModel": [
    {"hooks": [{"type": "command", "command": "kb-hook before-model --format gemini"}]}
  ],
  "PreCompress": [
    {"hooks": [{"type": "command", "command": "kb-hook pre-compact --format gemini"}]}
  ],
  "SessionEnd": [
    {"matcher": "",
     "hooks": [{"type": "command", "command": "kb-hook session-end --format gemini"}]}
  ]
}
```

### Pi Extension

Calls `src/hooks/*` directly — no binary, no serialization:

```typescript
// Common hooks — shared logic
pi.on('before_agent_start', (event, ctx) =>
  sessionStart(store, state, brainPath, wsStorage, event));

pi.on('tool_call', (event, ctx) => {
  const gating = preToolUse(brainPath, event);
  if (gating) return gating;
  collectSignals(state, event);          // Pi-only: signal collection
});

pi.on('context', (messages) =>           // Pi-only: per-turn injection
  contextInjection(store, state, brainPath, messages));

pi.on('tool_result', (event) => collectResultSignals(state, event));
pi.on('input', (event) => collectInputSignals(state, event));
pi.on('session_shutdown', () => sessionEnd(brainPath));

pi.registerCommand('kb', kbCommandHandler(store, state));
registerTools(pi, store, brainPath, wsStorage);
```

## Packaging

The `kb-hook` binary and `hooks.json` are **profile-scoped** — they belong to the kb profile, not to vfa or any runtime globally.

**Build:** `bun build --compile src/cli/hook.ts --outfile dist/kb-hook`

**Container delivery:** vfa mounts the binary and hooks.json into the container as part of the kb profile's configuration. The profile declares what hooks it needs; vfa wires them for the runtime being used.

**Pi delivery:** The mykb npm package includes the extension. No binary needed — hooks run in-process.

## Refactoring Required

Current Pi extension has hook logic in `src/extension/hooks/*.ts`. Extract to shared layer:

| Current location | Move to | Shared or runtime-specific? |
|-----------------|---------|---------------------------|
| `src/extension/hooks/session.ts` | `src/hooks/session-start.ts` | Shared |
| `src/extension/hooks/context.ts` | `src/hooks/context.ts` | Shared (Pi uses full pipeline, Claude/Gemini use scorer subset) |
| `src/extension/hooks/tool-gating.ts` | `src/hooks/pre-tool-use.ts` | Shared |
| `src/extension/hooks/signals.ts` | `src/hooks/signals.ts` | Shared (Pi uses in-process, Claude/Gemini N/A) |
| `src/extension/scorer.ts` | `src/hooks/scorer.ts` | Shared (Pi uses for injection, Claude/Gemini use for matching) |
| N/A (new) | `src/hooks/post-bash.ts` | Shared (capture nudges) |
| N/A (new) | `src/hooks/post-edit.ts` | Shared (impact check) |
| N/A (new) | `src/hooks/post-read.ts` | Shared (citation check) |
| N/A (new) | `src/hooks/before-model.ts` | Gemini-specific (message injection) |
| N/A (new) | `src/hooks/after-agent.ts` | Gemini-specific (response quality + journal reminder) |

## Dependencies

| Component | Status | Needed for |
|-----------|--------|-----------|
| `src/hooks/` shared layer | **Needs building** (extract from Pi extension) | All hooks |
| `kb hook <event>` CLI command | **Needs building** | Claude Code + Gemini delivery |
| `bun build --compile` pipeline | **Needs building** | Fast binary for containers |
| `kb match <text> --json` | **Needs building** (expose scorer as CLI) | H4, H5, H6 (area matching) |
| `kb check-impact <path> --json` | **Needs building** | H9 (impact check) |
| `kb check-citation <path> --json` | **Needs building** | H10 (stale citation) |
| Profile-scoped hook wiring in vfa | **Needs building** | Container delivery |
| `kb work list/show`, `kb list/load/save` | **Exists** | H1, H3 |

## Implementation Phases

### Phase 1: Foundation (H1 + H2 + H3)

Extract shared hook logic from Pi extension. Build `kb hook` CLI and bun compile pipeline. Session start, tool gating, auto-save. Wire into vfa kb profile for Claude Code and Gemini.

### Phase 2: Area Matching (H4 + H5 + H6)

Build `kb match <text> --json`. Prompt and command matching with session dedup. Gemini `BeforeModel` injection for H6.

### Phase 3: Capture Nudges (H7 + H8 + H9 + H10)

Error→fix detection, save reminders, impact checks, citation checks. Build `kb check-impact` and `kb check-citation`.

### Phase 4: Behavioral Enforcement (H11 + H12 + H13 + H14 + H15)

Journal reminders (Claude: Stop prompt hook, Gemini: AfterAgent retry). Compaction checkpoint and recovery. Gemini response quality check and BeforeModel knowledge injection.

### Phase 5: Advanced (H16 + H17 + H18)

Conflict detection, structured output extraction, Gemini tool selection enforcement.

## Decisions

### D1: Hook binary — separate `kb-hook` command

Separate compiled binary via `bun build --compile`. Accepts the more complex install process (two binaries: `kb` for CLI use, `kb-hook` for hook events) in exchange for smaller binary size and cleaner separation of concerns.

### D2: Brain path — `$MYKB_DIR` environment variable, no hardcoding

mykb already respects `$MYKB_DIR` (defaults to `~/.mykb`). The vfa profile sets this in its `env` section:

```yaml
env:
  MYKB_DIR: /home/node/.mykb
```

The `kb-hook` binary uses the same `resolveBrainPath()` as the rest of mykb. No hardcoded paths anywhere. If someone mounts the brain at a different location, they change the profile env, not the code.

### D3: Hooks.json delivery — static files, convention-based

Pre-written hooks.json files per runtime, stored alongside the profile:

```
~/.vf-agents/hooks/kb/
  claude/hooks.json
  gemini/hooks.json
```

vfa mounts the right one based on the provider's runtime. No dynamic generation, no startup cost. Files are part of the mykb distribution and versioned with the hook scripts.

For Claude Code: mounted as a plugin's `hooks/hooks.json`.
For Gemini CLI: merged into `.gemini/settings.json` or extension hooks.

### D4: Gemini tool names — verified

| Function | Gemini tool name | Claude Code tool name |
|----------|-----------------|----------------------|
| Read file | `read_file` | `Read` |
| Write file | `write_file` | `Write` |
| Edit file | `replace` | `Edit` |
| Shell command | `run_shell_command` | `Bash` |
| Search content | `search_file_content` | `Grep` |
| Glob files | `glob` | `Glob` |

Source: [Gemini CLI tools reference](https://geminicli.com/docs/reference/tools/)

### D5: Journal enforcement strategy — different per runtime

**The check** is shared: "was `kb work journal` called during this session?" Lives in `src/hooks/stop.ts`, reads session state file.

**The delivery** differs:

| Runtime | Mechanism | Why |
|---------|-----------|-----|
| Claude Code | `Stop` prompt hook — forces continuation with "please journal" | Efficient: extends conversation, doesn't rewrite. Claude adds journal command. |
| Gemini CLI | `BeforeAgent` nudge on next prompt — injects "you haven't journaled yet" as `additionalContext` | Avoids wasteful `AfterAgent` retry which would regenerate the entire response. |
| Gemini CLI (backup) | `SessionEnd` — best-effort `kb work journal "auto: session ended without journal"` | Catches the case where user exits without another prompt. |
| Pi | Instructions only — no stop/end hook available | Pi's `session_shutdown` runs `kb save` but can't enforce journaling. |

**`AfterAgent` retry is reserved for quality enforcement only** — "your response didn't use available knowledge, try again." This is Gemini-specific (H14) and justifies the retry cost because it produces a better answer, not just an appended action.

### D6: BeforeModel — needs spike before committing

Gemini's `BeforeModel` fires on every LLM call (potentially 1-5 per turn). Running `kb match` + entry selection on each call may add unacceptable latency. A spike is required before committing to H15 (knowledge-aware model requests).

Spike document: [`docs/spikes/before-model-cost-SPIKE.md`](spikes/before-model-cost-SPIKE.md)

Decision criteria:
- <100ms per invocation → use BeforeModel for injection
- 100-200ms → use selectively (first turn only, or throttled)
- \>200ms → fall back to BeforeAgent nudge only

### D7: Session state — single JSON file

`kb-hook` is a TypeScript binary. JSON is its native language. Reading/writing a single state file is one line of code. The OSB pattern of multiple flat files was designed for shell scripts where JSON parsing is painful — that doesn't apply here.

Single file at `/tmp/kb-hook-$session_id.json`:
```json
{
  "suggested_areas": ["networking", "docker-swarm"],
  "bash_count": 15,
  "prev_exit_code": 1,
  "journal_written": false
}
```

Containers are ephemeral — `/tmp` is auto-cleaned. Corruption risk is acceptable (worst case: one extra area suggestion mid-session). Performance is irrelevant — process startup (~50ms) dominates over file I/O (<1ms).

### D8: Pi extension refactor — separate PR, spike first

Two-step approach:
1. **Spike first** — Verify extraction doesn't break Pi's esbuild bundling and extension loading. See [`docs/spikes/pi-hook-extraction-SPIKE.md`](spikes/pi-hook-extraction-SPIKE.md). Key risks: circular imports between `src/hooks/` and `src/extension/`, `SessionState` dependency, `better-sqlite3` native module in bun compile, and esbuild import path resolution.
2. **Phase 1a** — Extract `src/extension/hooks/*.ts` → `src/hooks/*.ts`. Pi extension becomes thin adapter. Run all 234 unit tests + Pi acceptance tests. Separate PR.
3. **Phase 1b** — Build `kb-hook` CLI on top of extracted layer. Separate PR.

Rationale: the extraction is a pure refactor — if it breaks something, the cause is clear. Mixing refactor + new feature makes debugging harder. Pi's extension loading has bitten us before.

### D9: Packaging — profile-scoped only, no extensions

Hooks only work inside vfa containers (brain mounted, binary available, profile env set). There is no standalone use case today. Packaging as Claude Code plugin or Gemini extension would be designing for a use case that doesn't exist.

```
~/.vf-agents/hooks/kb/
  claude/hooks.json
  gemini/hooks.json
  bin/kb-hook
```

vfa mounts the appropriate `hooks.json` and `kb-hook` binary based on the runtime. When standalone usage (host without vfa) becomes needed, we package as extensions then.

## Open Questions

All design questions resolved (D1-D9). Remaining unknowns require spikes before implementation can begin.

## Status

**Work in progress.** Design complete. Two spikes must be run before Phase 1 implementation.

## Related Documents

- [BeforeModel cost spike](spikes/before-model-cost-SPIKE.md) — Determines whether H15 uses Gemini BeforeModel or falls back to BeforeAgent
- [Pi hook extraction spike](spikes/pi-hook-extraction-SPIKE.md) — Determines whether esbuild bundles extracted imports correctly and Pi loads the result
- [Workspaces design](workspaces-DESIGN.md) — Workspace feature that hooks interact with
- [Implementation plan](implementation-PLAN.md) — Overall mykb implementation phases
- [OSB hook system](https://github.com/vilosource/osb/blob/main/docs/architecture/hook-system.md) — Reference implementation for Claude Code nudge-based hooks
