# Claude Code Hooks for mykb

## Context

mykb has three delivery tiers built for Pi's extension model:

- **Tier 1** — Area index + active workspace injected into system prompt at session start (`before_agent_start`)
- **Tier 2** — Relevant facts auto-injected mid-conversation based on signal scoring (`context` event)
- **Tier 3** — On-demand area loading via `/kb` command

When running inside a vfa container with Claude Code, the Pi extension is not available. Claude Code has its own hook system that can replicate most of this behavior through shell scripts that call the `kb` CLI.

## Reference Systems

### Pi Extension (in-process, shared state)

| Event | Handler | Behavior |
|-------|---------|----------|
| `session_start` | session.ts | Auto-init brain, recover dirty shutdown |
| `before_agent_start` | session.ts | Inject area index + active workspace state into system prompt |
| `context` | context.ts | Per-turn: accumulate signals → score areas → select entries within 2000-token budget → inject as system message |
| `tool_call` | tool-gating.ts | Block direct writes to `.jsonl`/`area.json`, redirect to `kb_add` |
| `tool_call` | signals.ts | Collect file path signals from Read/Write/Edit |
| `tool_result` | signals.ts | Collect keyword signals from tool output (first 500 chars) |
| `input` | signals.ts | Collect keyword signals from user text |
| `session_shutdown` | session.ts | Auto-save brain to git |

Key advantage: shared `SessionState` accumulates signals across turns, tracks loaded/boosted areas.

### OSB Plugin (shell scripts, temp-file state)

| Hook Event | Script | Behavior |
|-----------|--------|----------|
| `SessionStart` | `osb-session-start.sh` | Detect workspace from CWD, load context + linked areas + Jira epic → `systemMessage` |
| `SessionStart` | `osb-check-sync.sh` | Warn if local brain behind remote git |
| `UserPromptSubmit` | `osb-match-prompt.sh` | Match user prompt against area index, suggest unloaded areas (session dedup via `/tmp/osb-loaded-areas-$session_id`) |
| `PreToolUse(Bash)` | `osb-pre-bash.sh` | Match bash command against areas, suggest knowledge |
| `PostToolUse(Read)` | `osb-post-read.sh` | Check if read file is cited by a fact, warn if stale |
| `PostToolUse(Edit\|Write)` | `osb-post-edit.sh` | Check if edited file impacts known facts |
| `PostToolUse(Bash)` | `osb-post-bash.sh` | Error→fix gotcha capture, periodic save reminder, conflict detection, structured output extraction |

Key patterns:
- All hooks output `{"systemMessage": "..."}` — nudge, never block (except tool gating)
- Session dedup via temp files (`/tmp/osb-loaded-areas-$session_id`)
- Counter files for periodic reminders (`/tmp/osb-bash-count-$session_id`)
- Exit code tracking for fail→success gotcha capture (`/tmp/osb-prev-exit-$session_id`)
- Graceful degradation: `command -v kb &>/dev/null || exit 0`

## Claude Code Hook System

Claude Code supports these hook events (relevant subset):

| Event | When it fires | Can inject context? | Can block? |
|-------|--------------|-------------------|-----------|
| `SessionStart` | Session begins, resumes, or compaction | Yes — stdout or `additionalContext` | No |
| `UserPromptSubmit` | User submits a prompt | Yes — `additionalContext` | Yes — `decision: "block"` |
| `PreToolUse` | Before tool call | Yes — `additionalContext` | Yes — `permissionDecision: "deny"` |
| `PostToolUse` | After tool succeeds | Yes — `additionalContext` | No (already executed) |
| `PostToolUseFailure` | After tool fails | Yes — `additionalContext` | No |
| `Stop` | Claude finishes responding | Yes — `decision: "block"` forces continuation | Yes |
| `SessionEnd` | Session terminates | No (cleanup only) | No |
| `PreCompact` | Before compaction | Yes | No |
| `PostCompact` | After compaction | Yes | No |

Key differences from Pi:
- No per-turn `context` event — must approximate via `UserPromptSubmit` + `PostToolUse`
- No shared in-process state — must use temp files for cross-hook state
- Hooks are shell commands (external process), not in-process functions
- `SessionStart` fires on `compact` — can re-inject context after compaction (Pi cannot)
- `Stop` hook can force continuation — useful for journaling reminders

## Hook Design

### P1: Session Start — Context Injection

**Event:** `SessionStart` with matcher `startup|resume|compact`

**Behavior:** Load workspace state and area index, inject as context.

**Script:** `kb-session-start.sh`
```
Read JSON from stdin → extract source (startup/resume/compact)
If startup or resume:
  kb work list → check for active workspace
  If active workspace:
    kb work show → workspace state, journal, what's next
    kb load <linked-areas> → knowledge for linked areas
  Else:
    kb list → available areas
If compact:
  Re-inject active workspace state (context was lost)
Output: {"systemMessage": "<assembled context>"}
```

**Why:** The agent starts every session knowing where work left off and what knowledge is available. Re-injection on compaction prevents context loss during long sessions.

### P2: Prompt Matching — Area Suggestions

**Event:** `UserPromptSubmit`

**Behavior:** Match user's prompt against area index, suggest loading relevant areas not yet loaded this session.

**Script:** `kb-match-prompt.sh`
```
Read JSON from stdin → extract prompt, session_id
Load dedup file: /tmp/kb-loaded-areas-$session_id
kb match "$prompt" --json → scored area matches
Filter: score >= 2, not already suggested
Append newly suggested areas to dedup file
Output: {"systemMessage": "Relevant areas: X, Y. Load with: kb load <area>"}
```

**Needs:** `kb match <text> --json` CLI command (scorer logic exposed as CLI).

**Why:** The agent discovers relevant knowledge automatically as the conversation evolves, without the user having to explicitly ask for it.

### P3: Tool Gating — Protect Brain Files

**Event:** `PreToolUse` with matcher `Edit|Write`

**Behavior:** Block direct writes to brain files, redirect to `kb add`.

**Script:** `kb-tool-gate.sh`
```
Read JSON from stdin → extract tool_input.file_path
If path starts with brain dir OR ends with .jsonl OR is area.json/manifest.json:
  Exit 2 with stderr: "Do not edit knowledge files directly. Use kb add/update instead."
Else:
  Exit 0 (allow)
```

**Needs:** Nothing new — pure path checking.

**Why:** Prevents the agent from bypassing the knowledge store's append-only JSONL format and dual-write guarantees.

### P4: Post-Bash Nudges

**Event:** `PostToolUse` with matcher `Bash`

**Behavior:** Multiple nudges after bash commands.

**Script:** `kb-post-bash.sh`
```
Read JSON from stdin → extract command, exit_code, session_id

Nudge A — Error→fix capture:
  Track exit codes in /tmp/kb-prev-exit-$session_id
  On fail→success transition:
    Suggest: "Previous command failed. Consider: kb add gotcha <area> '<what failed>'"

Nudge B — Periodic save reminder:
  Count bash commands in /tmp/kb-bash-count-$session_id
  Every 20th command:
    Suggest: "Consider saving progress: kb work journal '<summary>' && kb save"

Nudge C — Post add-fact checks (if command contains "kb add"):
  Check for conflicts with existing entries

Output: {"systemMessage": "<combined nudges>"} if any triggered
```

**Needs:** Nothing new for A and B. Conflict checking (C) would need `kb check-conflict` but is optional for v1.

**Why:** Captures institutional knowledge at the moment of discovery (gotchas from debugging, patterns from solutions).

### P5: Impact Check on Edit

**Event:** `PostToolUse` with matcher `Edit|Write`

**Behavior:** When the agent edits a file referenced by knowledge entries, nudge to update the affected knowledge.

**Script:** `kb-post-edit.sh`
```
Read JSON from stdin → extract tool_input.file_path
kb check-impact "$file_path" --json
If triggered:
  Output: {"systemMessage": "File <path> is referenced by facts in area <X>. Verify if knowledge needs updating."}
```

**Needs:** `kb check-impact <path> --json` CLI command.

**Deferred:** Not in v1. Requires provenance/source tracking in entries.

### P6: Stale Citation Check on Read

**Event:** `PostToolUse` with matcher `Read`

**Behavior:** When the agent reads a file cited as source for a fact, check if the fact is stale.

**Script:** `kb-post-read.sh`
```
Read JSON from stdin → extract tool_input.file_path
kb check-citation "$file_path" --json
If triggered:
  Output: {"systemMessage": "File <path> is cited by fact <id> in area <X>, last verified <date>. Consider: kb verify <area> <id>"}
```

**Needs:** `kb check-citation <path> --json` CLI command.

**Deferred:** Not in v1. Requires provenance/source tracking in entries.

### P7: Stop Hook — Journal Reminder

**Event:** `Stop` (no matcher — fires every time Claude finishes responding)

**Behavior:** Prompt-based hook that checks whether the agent journaled progress during this session.

**Config:**
```json
{
  "type": "prompt",
  "prompt": "Check if the assistant has run 'kb work journal' during this session. If significant work was done but no journal entry was made, respond with {\"ok\": false, \"reason\": \"Please journal your progress before finishing: kb work journal '<summary of what was done>'\"}. If journal was already written or no significant work was done, respond with {\"ok\": true}."
}
```

**Needs:** Nothing new — uses Claude Code's built-in prompt hook type.

**Trade-off:** This fires every time Claude stops responding, not just at session end. The `stop_hook_active` guard prevents infinite loops. May be noisy — could be deferred to v2.

### P8: Session End — Auto-Save

**Event:** `SessionEnd`

**Behavior:** Save brain to git.

**Script:** `kb-session-end.sh`
```
kb save 2>/dev/null || true
```

**Needs:** Nothing new.

**Note:** Already covered by the post-run lifecycle hook (`kb save || true`). This is a safety net for cases where the post-run hook doesn't fire (e.g., container crash). The `SessionEnd` timeout is 1.5 seconds by default — `kb save` (git add + commit) may exceed this. Can configure via `CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS`.

### P9: Pre-Bash — Command Matching

**Event:** `PreToolUse` with matcher `Bash`

**Behavior:** Match bash command against area index, suggest relevant knowledge before execution.

**Script:** Reuses the same `kb match` logic as P2.

```
Read JSON from stdin → extract tool_input.command
kb match "$command" --json → scored matches
Filter and dedup (same pattern as P2)
Output: {"systemMessage": "Area knowledge available: <ids>. Consider: kb load <area>"}
```

**Needs:** Same `kb match <text> --json` as P2.

## Implementation Phases

### Phase 1: Foundation (P1 + P3 + P8)

Session start context injection, tool gating, auto-save. These work with existing `kb` CLI commands and provide the core experience.

- `kb-session-start.sh` — workspace + area index injection
- `kb-tool-gate.sh` — brain file protection
- `kb-session-end.sh` — auto-save safety net
- `hooks.json` — hook configuration

### Phase 2: Area Matching (P2 + P9)

Prompt and command matching against area index. Requires new `kb match` CLI command.

- `kb match <text> --json` CLI command (expose scorer as CLI)
- `kb-match-prompt.sh` — user prompt matching
- `kb-pre-bash.sh` — bash command matching

### Phase 3: Behavioral Nudges (P4 + P7)

Post-bash nudges and journal reminders. Enriches the experience with proactive knowledge capture suggestions.

- `kb-post-bash.sh` — error→fix, save reminders
- Stop hook (prompt type) — journal reminder

### Phase 4: Provenance Hooks (P5 + P6)

Impact and citation checking. Requires provenance tracking in entries.

- `kb check-impact` and `kb check-citation` CLI commands
- `kb-post-edit.sh` and `kb-post-read.sh`

## Packaging

The hooks should be packaged as part of the vfa kb profile, not as a Claude Code plugin. They're container-specific (paths, brain location) and tied to the vfa profile's volume mounts.

**Location:** `~/.vf-agents/hooks/kb/` containing the scripts and `hooks.json`.

**Instruction assembly:** vfa's instruction assembler would mount the hooks directory and configure Claude Code to load the `hooks.json` from it.

Alternatively, the hooks could be a Claude Code plugin at `~/.vf-agents/plugins/kb/` with a `plugin.json` + `hooks/hooks.json` structure. This uses Claude Code's native plugin discovery.

## Dependencies

| Component | Status | Needed for |
|-----------|--------|-----------|
| `kb work list` | Exists | Phase 1 |
| `kb work show` | Exists | Phase 1 |
| `kb list` | Exists | Phase 1 |
| `kb load` | Exists | Phase 1 |
| `kb save` | Exists | Phase 1 |
| `kb match <text> --json` | **Needs building** | Phase 2 |
| `kb check-impact <path> --json` | **Needs building** | Phase 4 |
| `kb check-citation <path> --json` | **Needs building** | Phase 4 |

## Open Questions

1. **Plugin vs profile hooks?** Should the hooks be a Claude Code plugin (discoverable, toggleable) or baked into the vfa profile (simpler, always active)?

2. **Signal accumulation** — Pi accumulates signals across turns via shared state. The OSB plugin uses temp files for dedup but doesn't do multi-turn scoring. Is single-prompt scoring (P2) good enough, or do we need the full accumulation pattern?

3. **Stop hook noise** — The `Stop` event fires every time Claude finishes responding, not just at session end. Is the prompt-based journal reminder (P7) worth the overhead, or should journaling be instruction-only?

4. **Brain path detection** — Inside the container, the brain is at `/home/node/.mykb/brain/`. The hooks need to know this path. Should it be hardcoded, read from `$MYKB_DIR`, or detected?

5. **SessionEnd timeout** — Default is 1.5 seconds. `kb save` may take longer. Should we configure `CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS`, or rely solely on the post-run lifecycle hook?
