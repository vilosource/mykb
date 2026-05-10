# Experiment: kb-command

**Source spec:** `src/extension/hooks/kb-command.ts` — registers the `/kb` slash command in the Pi runtime. Usage: `/kb <area-id> [area2...]` injects all entries from the named area(s) into the conversation context, marking them as loaded.
**Implementation under test:** the operator-driven on-demand area-load path. Distinct from the scorer-driven auto-injection (per-turn `<mykb-context>`) and from the LLM-driven `kb_load` tool — `/kb` is a user-typed command in the Pi terminal.

## Status

🚧 **Scaffolded — scenarios not yet implemented.** Tracked in [`docs/experiment-coverage.md`](../../docs/experiment-coverage.md).

## Intent

`/kb` is the operator's "force this area into context now" lever. It's used when:
- The scorer didn't pick the right area for the turn.
- The operator knows the next prompt will need a domain they haven't yet touched.
- A spike / debugging session wants explicit control over what's in context.

The implementation reads each area's entries (excluding archive zone), calls Pi's `ctx.inject()` to add them as a context block, and updates `state.loadedAreas` (so the sticky-area boost picks them up on subsequent turns).

The L4 questions are:
- Does `/kb <id>` actually inject entries the LLM can see and cite?
- Does an unknown area-id surface a useful error rather than silently doing nothing?
- Does `/kb a b c` (multiple) inject all three?
- Does the load persist as a sticky area (covered by the area-scoring matrix's sticky scenario when implemented)?

## Behavior matrix

| Stimulus | Expected behavior | Scenario |
|----------|-------------------|----------|
| Operator types `/kb <area-id>`; subsequent prompt asks for a fact in that area | Entries injected; LLM cites the marker | `load-and-cite` |
| Operator types `/kb` with no arguments | Usage message injected; no area loaded | `usage-on-empty-args` |
| Operator types `/kb <unknown-id>` | Error message injected (no entries); state unchanged | `unknown-area-error` |
| Operator types `/kb <area1> <area2>` | Both areas' entries injected | `multiple-areas` |

## Notes (when implementing)

- **Pi slash-command harness path** — verify how `step` (or kb-spike's `run`) can deliver a slash-command vs a regular prompt. Pi's `--prompt "/kb foo"` may or may not route through the slash-command handler. May need a new `step --command` variant if not.
- **The load-and-cite scenario** is two-step: step 1 issues `/kb <area>`, step 2 asks for the fact. Cycle 8's persistence handles state continuity.
- **Marker discipline** — the marker is in the entry text (added in prepare via `kb add fact`); assert it appears in the LLM's step-2 response.

## Out of scope

- The slash-command lookup / registration path (Pi's responsibility).
- Sticky-area boost behavior post-load — that's the area-scoring matrix's sticky-area sub-behavior.
- Cross-zone behavior (loading archived entries) — `/kb` excludes archive by design.
