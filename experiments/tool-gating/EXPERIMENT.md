# Experiment: tool-gating

**Source spec:** `src/extension/hooks/tool-gating.ts` (`createToolGatingHandler`).
**Implementation under test:** the `tool_call` event handler that blocks `Write`/`Edit` calls targeting paths inside `brainPath` (or matching knowledge-file shapes: `*.jsonl`, `area.json`, `manifest.json`). Returns `{ block: true, reason: ... }` to refuse the call before it executes.

## Status

🚧 **Scaffolded — scenarios not yet implemented.** Tracked in [`docs/experiment-coverage.md`](../../docs/experiment-coverage.md).

## Intent

Tool-gating is a safety hook. An LLM with `Write`/`Edit` tools registered (by Pi's runtime, not by mykb) could, in principle, bypass `kb_add` / `kb_update` and write directly to `~/.mykb/areas/<id>/facts.jsonl` — corrupting the JSONL invariants the rest of the system depends on (id uniqueness, schema, tombstones, FTS sync).

The hook returns `{ block: true }` for any write to a knowledge file. Pi's runner respects the block, declines the call, and surfaces the `reason` text to the LLM — which is expected to retry via the proper tool.

A regression here is **brain corruption**. Layer 1 unit tests verify the gating logic in isolation. This experiment proves end-to-end:

1. The handler is wired into the `tool_call` event correctly.
2. Pi's runner honors the `{ block: true }` return.
3. The `reason` text reaches the LLM in a form it can act on.
4. The blocked file remains unchanged on disk.
5. Non-knowledge writes (e.g., a write to `/tmp/scratch.md`) are NOT blocked — gating is precise, not blanket.

## Behavior matrix

| Stimulus | Expected behavior | Scenario |
|----------|-------------------|----------|
| LLM tries to Write a file under `brainPath` | Tool call is blocked; reason text reaches LLM; file unchanged | `blocks-write-to-brain` |
| LLM tries to Edit a `*.jsonl` file outside brainPath | Blocked (filename pattern catches it) | `blocks-edit-by-pattern` |
| LLM tries to Write a non-knowledge file (e.g., `/tmp/note.md`) | NOT blocked; write proceeds | `allows-non-knowledge-writes` |
| LLM blocked once → retries the same content via `kb_add` | Second attempt succeeds (the suggested-tool path works) | `block-then-retry-via-kb-add` |

The pair `blocks-write-to-brain` + `allows-non-knowledge-writes` bounds the gating's precision from both sides. Without the negative, a "blocks everything" regression would still pass the positives. `block-then-retry-via-kb-add` is the integration anchor — proves the LLM actually understands the suggested alternative.

## Notes (when implementing)

- **Synthetic file paths** must use the per-instance brainPath (`/home/node/.mykb` inside the container) so the host's real brain is never touched.
- The blocked-write assertion needs a way to confirm the write *did not happen* on disk. `assert_branch_diff_not_contains "<knowledge-file>"` is the right tool.
- The "reason text reaches LLM" assertion can use `assert_llm_contains` against `kb_add` / `kb_update` / `kb_verify` (the suggested tools the reason mentions).
- For `block-then-retry-via-kb-add`, the prompt should explicitly accept retries: "If a tool is blocked, use the suggested alternative." Asserts `assert_tool_called "kb_add"`.

## Out of scope

- Pi's tool-call lifecycle internals (Pi's responsibility — covered by Pi's own tests).
- Provenance / verified-status tracking after a `kb_add` retry (that's the kb_verify experiment).
- Race conditions: two LLMs trying to write the same file at the same time (covered by `wsa add` claim-file logic at L1).
