# Experiment: kb-command

**Source spec:** `src/extension/hooks/kb-command.ts` — registers the `/kb` slash command in the Pi runtime. Usage: `/kb <area-id> [area2...]` injects all entries from the named area(s) into the conversation context (as a `mykb-loaded-areas` `custom`-role message via `pi.sendMessage`) and marks them loaded in `SessionState`.
**Implementation under test:** the operator-driven on-demand area-load path. Distinct from the scorer-driven auto-injection (per-turn `<mykb-context>`) and from the LLM-driven `kb_load` tool — `/kb` is a user-typed command in the Pi terminal.

## Status

🟡 **Implemented (partial).** 3 single-step scenarios GREEN against a real Pi runtime, each RED-proven. The 4th matrix row — `load-and-cite` (LLM cites a `/kb`-loaded marker) — is **blocked on harness support** ([issue #7](https://github.com/vilosource/mykb/issues/7)): `/kb` triggers no LLM turn, and the `step` helper can't deliver `/kb <area>` followed by a separate prompt in the same Pi process (`vfa run` = one `--prompt`, no Pi-level session continuity). The L1 test (`tests/extension/kb-command.test.ts`) plus these 3 scenarios cover dispatch + the `pi.sendMessage` content + `markAreaLoaded` persistence; the only uncovered leg is the LLM *reading* the injected `custom` message — which is the same `role:'custom'` → `convertToLlm` path `area-scoring/scoring-isolated.sh` already exercises end-to-end.

| Scenario | GREEN | RED-proof (mutated build) |
|----------|-------|---------------------------|
| `load-marks-area-loaded` | 7/7 | revert `kb-command.ts` to `{ description, **execute** }` → Pi throws `command.handler is not a function`; nothing emits the `mykb-loaded-areas` message and `.sessions/<id>.json` is never created (5 assertions flip). Variant pinpointing injection vs. dispatch: keep `handler` but swap `pi.sendMessage(...)` for the old `ctx.inject(...)` → `ctx.sendMessage is not a function`; the message-grep assertions flip but `loadedAreas` still persists (`markAreaLoaded` runs first). |
| `usage-on-empty-args` | 5/5 | drop the `if (areaIds.length === 0)` guard → `send("")` emits an empty message instead of the usage text (the usage assertion flips). |
| `unknown-area-no-load` | 7/7 | move `state.markAreaLoaded(areaId)` out of the `else` (run it for empty areas too) → the bogus id lands in `loadedAreas` (the "0 areas loaded" assertion flips; the "No entries found" message still appears, pinpointing the bug). |

> **History (kb gotcha `QbRwqLxJ` / `docs/findings-log.md`):** before this cycle, `/kb` had *never* worked against the real Pi runtime — `pi.registerCommand` was called with `{ description, execute }` (Pi's `RegisteredCommand` is `{ description, handler }`), and the handler called `ctx.inject(content)` which doesn't exist on Pi's `ExtensionCommandContext` (those methods live on the `pi` ExtensionAPI object). The L1 test masked both by calling `handler.execute(...)` directly with a hand-rolled `{ inject }` mock. The fix: `handler` not `execute`; `pi.sendMessage({ customType: 'mykb-loaded-areas', content, display: true })` not `ctx.inject`; thread `pi` into `createKbCommandHandler`; `pi-types.ts` corrected against `@mariozechner/pi-coding-agent`; L1 test rewritten to the real shape. Surfaced by *attempting* this matrix.

Tracked in [`docs/experiment-coverage.md`](../../docs/experiment-coverage.md).

## Intent

`/kb` is the operator's "force this area into context now" lever. It's used when:
- The scorer didn't pick the right area for the turn.
- The operator knows the next prompt will need a domain they haven't yet touched.
- A spike / debugging session wants explicit control over what's in context.

The implementation reads each area's entries (excluding archive zone), pushes them into the session via `pi.sendMessage(...)` as a `mykb-loaded-areas` `custom` message (wrapped in `<mykb-loaded-areas>…</mykb-loaded-areas>`), and updates `state.loadedAreas` (so the sticky-area boost picks them up on subsequent turns). A `/kb` invocation does **not** trigger an LLM turn — the loaded content sits in the conversation for the next prompt.

The L4 questions:
- Does `/kb <id>` dispatch the command, emit the loaded entries, and persist `loadedAreas`? — **`load-marks-area-loaded`** (covered).
- Does `/kb` with no args emit a usage message and load nothing? — **`usage-on-empty-args`** (covered).
- Does an unknown area-id surface a "no entries" message and change no state? — **`unknown-area-no-load`** (covered).
- Does the LLM, prompted after `/kb <area>`, cite a marker from that area? — **`load-and-cite`** (blocked, [issue #7](https://github.com/vilosource/mykb/issues/7)).
- Does `/kb a b` inject both? — single-step-testable; not yet written (a 2-area variant of `load-marks-area-loaded`).

## Behavior matrix

| Stimulus | Expected behavior | Scenario | State |
|----------|-------------------|----------|-------|
| Operator types `/kb <area-id>` | Command dispatches; a `mykb-loaded-areas` message carries that area's entries; the area is marked loaded in `SessionState`; no LLM turn, no error | `load-marks-area-loaded` | ✅ |
| ... and a *subsequent* prompt asks for a fact in that area | LLM cites the marker | `load-and-cite` | 🚧 blocked — [#7](https://github.com/vilosource/mykb/issues/7) |
| Operator types `/kb` with no arguments | Usage message emitted; no area loaded | `usage-on-empty-args` | ✅ |
| Operator types `/kb <unknown-id>` | "No entries found for: <id>" message; `loadedAreas` unchanged; the area is not created on disk | `unknown-area-no-load` | ✅ |
| Operator types `/kb <area1> <area2>` | Both areas' entries emitted; both marked loaded | `multiple-areas` | 🚧 single-step-testable; not yet written |

## Implementation notes (as built)

- **Single-step scenarios.** Because `/kb` triggers no LLM turn, `step "load" --prompt "/kb <area>"` runs the command and Pi exits. `observe()` reads `vfa logs --raw <run_id>` (the JSON event stream — the `message_start`/`message_end` events carry the `role:'custom'`, `customType`, and `content`) for the emitted message, and `assert_state_file_field ".sessions/${SPIKE_SCENARIO_SESSION_ID}.json" ...` for the persisted `loadedAreas`. `scenario.sh` wipes that `.sessions/` file at scenario start, so it only exists if the handler actually ran.
- **`load-and-cite` (blocked).** Would be two-step: `/kb <area>` then a prompt asking for the marker. But there's no Pi-level conversation continuity between `step` calls (each is a fresh `pi -p`; `KB_SESSION_ID` carries the *extension* state, not the chat), and `vfa run` takes one `--prompt`. Closing this needs a `step --command "/kb foo" --then-prompt "..."` (or `vfa session` continuity, or vfa multi-message) — see [issue #7](https://github.com/vilosource/mykb/issues/7). The LLM-reads-a-`custom`-message leg itself is not novel — `area-scoring/scoring-isolated.sh` already proves Pi's `convertToLlm` delivers `role:'custom'` content to the model.
- **Marker discipline** — the marker lives in the entry text (seeded in `prepare()` via `kb add fact`); assert it appears in the emitted `mykb-loaded-areas` message content (and, once `load-and-cite` is unblocked, in the LLM's response).

## Out of scope

- The slash-command lookup / registration / dispatch internals (Pi's responsibility — but the *shape* of what we register is ours: see the kb gotcha above).
- Sticky-area boost behavior post-load — that's the area-scoring matrix's sticky-area sub-behavior.
- Cross-zone behavior (loading archived entries) — `/kb` excludes archive by design.
