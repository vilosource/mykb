# Experiment: kb-list

**Source spec:** `src/tools/kb-list.ts` + `src/core/render.ts:65` (`renderAreaIndex`).
**Implementation:** `src/tools/kb-list.ts` (the LLM-facing tool), `src/core/area.ts` (`listAreas`), `src/core/render.ts:65` (`renderAreaIndex` — also used to render the `<mykb-areas>` system-prompt block).

## Intent

`kb_list` is the LLM's explicit "what areas exist?" tool. It returns the same content rendered into `<mykb-areas>` at session start (via `renderAreaIndex`), so under normal Pi runtime the system-prompt area-index makes the tool somewhat redundant — that redundancy is by design. The tool exists for cases where:

- The LLM didn't read or recall the system prompt and wants to ask explicitly.
- A future runtime / harness mode strips the system-prompt area-index (test / minimal-context / claude-code with truncated context).
- The operator deliberately asks the LLM to use `kb_list` (e.g., a CLI handoff like "use kb_list to enumerate areas").

The `kb_search` and `kb_load` cycles each closed a real bug or pinned a load-bearing chain. This experiment is a **regression guard** of the same shape as `kb_load`'s — the contract is well-covered at L1, but the L4 surface (tool registered, output parseable, tags suffix preserved) was unprotected. Combined with `kb_search` and `kb_load`, this completes the L4 anchor trio for the three LLM-facing knowledge tools.

## Behavior matrix

| Stimulus | Expected behavior | Scenario |
|----------|-------------------|----------|
| LLM is instructed to use kb_list to enumerate areas about a topic | Tool fires; result contains the area-id; LLM cites it | `basic-list` |
| LLM is instructed to use kb_list to find an area by tag | Tool fires; result includes the area's tags; LLM cites the area-id by matching tag (regression guard for `renderAreaIndex`'s `[tags: a, b]` suffix added in Cycle 2) | `lists-tags-suffix` |
| LLM is instructed to use kb_list to find an area about a topic that doesn't exist | Tool fires; LLM reports no match without fabricating | `no-match-no-fabrication` |

The `lists-tags-suffix` scenario is the load-bearing one: it protects the tags rendering that `kb_init area --tags`, the manifest-tag schema, and `<mykb-areas>` injection all rely on. If `renderAreaIndex` regresses the tags suffix, multiple unrelated downstream contracts break silently. This scenario gives that surface a single L4 anchor.

## Notes

- **Synthetic area per run.** Each scenario creates `e2e-frobnicators-${E2E_RUN_UUID:0:8}` for determinism against any specimen content.
- **Marker discipline.** kb_list does NOT return entry-level facts (only area metadata), so the assertion can't pin a `FROB_MARKER_*` from a fact. Instead the scenarios pin against the per-run synthetic area-id (e.g., `assert_llm_contains "$AREA_ID"`) — that's unique enough to prove the answer came from kb_list's output rather than from imagination.
- **No fallback-tool ban.** Unlike `kb_search` and `kb_load`, where the experiment isolates one tool path, kb_list intentionally overlaps with `<mykb-areas>` injection. The scenarios assert kb_list was called (proving the tool path works) but allow the LLM to use the system-prompt area-index as well — there's no "wrong path" here. The `assert_no_tool_calls "kb_search"` + `assert_no_tool_calls "kb_load"` guards remain to prevent the LLM from sliding to the *entry-level* tools when an area-level question was asked.
- **No workspace in `prepare()`.** Following the FYSqWj10 lesson from kb-load: `<mykb-workspace>` lists linked area-ids, which would let the LLM bypass kb_list and answer from the workspace block. We omit the workspace so the area-id is reachable only via the area index or kb_list — keeping kb_list a meaningful tool path even in `basic-list`.

## Out of scope

- The `count` field in `details: { count: N }`. The LLM's ability to read structured fields from a tool result is an LLM-prompt-engineering concern, not a contract concern.
- Ordering of areas in the output. We assert the target area-id appears, not that it appears first.
- Empty-brain case. `prepare()` runs against a clone of the specimen, which always has many areas; deleting all of them is not plausible workflow lineage. The empty case is L1-covered (`tests/tools/kb-list.test.ts`).
