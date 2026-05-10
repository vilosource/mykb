# Experiment: kb-load

**Source spec:** `src/tools/kb-load.ts` + `src/core/knowledge-store.ts:125` (`loadArea`).
**Implementation:** `src/tools/kb-load.ts` (the LLM-facing tool), `src/core/knowledge-store.ts:125` (`store.loadArea`), `src/core/db.ts` (`queryEntries` with `{area, ...filter}`), `src/core/render.ts` (`renderMarkdown`).

## Intent

`kb_load` is the LLM's "give me everything for this area" tool. Where `kb_search` does keyword retrieval, `kb_load` is the canonical path for "I know which area is relevant; pull all of its knowledge." Two L4-only properties matter and are not pinned by unit tests:

1. **The system-prompt area-index → kb_load chain.** The Pi extension injects `<mykb-areas>` into the system prompt with each area's id, name, summary (and now tags — added in Cycle 3). The LLM is expected to use that index to discover the right area-id, then call `kb_load(area-id)`. The `kb_search` experiment (Cycle 5) surfaced the cost of this path being broken: that experiment's first RED-proof falsely passed because the LLM, when `kb_search` returned "No matches," fell back to `kb_load(area-id from <mykb-areas>)`. That fallback now load-bears for kb_search's failure modes, but no L4 scenario currently regression-guards it. This experiment closes that gap.

2. **Markdown output is LLM-parseable.** `renderMarkdown` produces the text the LLM has to read to extract specific facts. If its shape changes (heading levels, marker placement, entry separators), an LLM that previously could quote a fact verbatim may stop being able to. Unit tests on render output prove the shape; only an L4 proves the LLM can still find a specific fact in it.

The unit tests in `tests/tools/kb-load.test.ts` cover basic load / unknown area / zone filter / tag filter at the function level. This experiment defends the L4 surface: real Pi, real LLM, real system-prompt area-index.

## Behavior matrix

| Stimulus | Expected behavior | Scenario |
|----------|-------------------|----------|
| Prompt names the area-id explicitly; LLM is told to use kb_load | Tool fires; LLM cites the marker fact from the area's entries | `basic-load` |
| Prompt names only the topic; LLM must discover the area-id from `<mykb-areas>` then call kb_load | Tool fires; LLM cites the marker. Proves the area-index → kb_load fallback chain | `discover-via-area-index` |
| Prompt names a nonexistent area-id and instructs use of kb_load | Tool fires; tool returns "No entries found"; LLM reports the no-result and does NOT fabricate the marker | `unknown-area-no-fabrication` |

The pair `basic-load` (positive) + `unknown-area-no-fabrication` (negative) bounds kb_load's contract from both sides at the L4 surface. `discover-via-area-index` is the integration regression guard — the load-bearing scenario for this experiment, since it's the only one that proves the scoring/area-index path the kb_search experiment depends on.

## Notes

- **Synthetic area per run.** Each scenario creates `e2e-frobnicators-${E2E_RUN_UUID:0:8}` so the assertion is deterministic regardless of specimen content.
- **Marker discipline.** The fact text contains a unique `FROB_MARKER_<run-uuid>`. The marker proves the entry's content reached the LLM — not just that the LLM heard the topic from the prompt or area summary.
- **Tool isolation in `discover-via-area-index`.** The prompt instructs "Use ONLY kb_load. Do not use kb_search or kb_list." The companion `assert_no_tool_calls "kb_search"` + `assert_no_tool_calls "kb_list"` prove the answer came through the kb_load path, not through a search index that happens to find the marker. This applies the methodology gotcha (kb gotcha `WmFjQOKa`) discovered in Cycle 5: tool-call scenarios must forbid fallback tools in BOTH the prompt AND the observe() assertions.
- **Path-isolation discipline in `discover-via-area-index`.** The scenario does NOT create or link a workspace, even though every other scenario in this branch does. Reason: the `<mykb-workspace>` block (when an active workspace exists) lists its linked area-ids, giving the LLM a second discovery path that bypasses `<mykb-areas>`. The first RED-proof of this scenario falsely passed because of that leak — the LLM read the area-id from the workspace block while the area-index was gutted. To genuinely isolate the area-index path, `<mykb-areas>` must be the only place the area-id appears in system context. Generalized methodology lesson: scenarios that claim to isolate one injection path must verify, by RED-proof, that no parallel path serves the same information. Companion to the WmFjQOKa fallback-tools rule.
- **`unknown-area-no-fabrication` uses a per-run nonce area-id** (`e2e-nonexistent-<run-uuid>`) — no real area can satisfy it.
- **No `MYKB_DISABLE_TOOLS` here** — this experiment is *about* the tool. The companion area-scoring `scoring-without-tools` exercises the disable knob.

## Out of scope

- `zone` and `tag` parameter filtering. Covered by L1 unit tests; the LLM's ability to construct correct filter parameters is an LLM-prompt-engineering question more than a contract question.
- Output ordering / ranking. We only assert the marker entry appears in the output, not that it appears first.
- Cross-area boundary: `kb_load("unrelated")` does not return entries from other areas. Covered by `queryEntries`'s WHERE clause and unit tests.

## Why this is a regression-guard cycle, not a fix-driver

Unlike Cycles 1–5 which all closed real bugs surfaced by RED-driving scenarios, this cycle protects an already-correct contract from future regression. Layer 4 has positive value here because:

- The `<mykb-areas>` block's content shape changed twice in this branch (Cycle 1 added tags; Cycle 2 changed display format). Either could have broken the area-index → kb_load chain silently — there was no scenario to catch it.
- Future renderMarkdown changes for compactness/token-budget reasons will affect kb_load output. Without an L4 anchor, "the LLM still finds the fact" devolves into ad-hoc operator testing.
- The kb_search experiment (Cycle 5) implicitly relies on the kb_load fallback being correct in its negative scenarios. Pinning kb_load explicitly protects kb_search's matrix from regressing in a non-obvious way.
