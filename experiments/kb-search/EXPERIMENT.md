# Experiment: kb-search

**Source spec:** `src/tools/kb-search.ts` + `src/core/db.ts` (`searchEntries`, `entries_fts`).
**Implementation:** `src/tools/kb-search.ts` (the LLM-facing tool), `src/core/knowledge-store.ts:130` (`store.search`), `src/core/db.ts:294` (`searchEntries`, the FTS5 query).

## Intent

`kb_search` is the LLM's primary recall tool inside a Pi session. When the model decides "I need to look something up," `kb_search <query>` is the path: it runs an FTS5 MATCH over `entries_fts` and returns matched entries rendered as markdown.

The current FTS schema is `entries_fts(id, text, tags, area)` where `area` is the area-id slug only (e.g. `widgets`). **An area's `summary` and area-level `tags` are not indexed.** This means a query whose keyword appears only in the area's metadata — but is contextually clearly about every entry in that area — returns zero results, even though every entry in the area is on-topic.

This is the user-visible cost of the gap surfaced in the area-scoring experiment (see `experiments/area-scoring/EXPERIMENT.md`'s "Important caveat"). The scorer-side gap was about manifest-vs-tags propagation; this is the search-side gap. They're independent symptoms of the same omission: area metadata isn't first-class searchable knowledge.

Layer-1 unit tests can pin the contract of `searchEntries` directly. The Layer-4 scenario proves the user-visible behavior: an LLM that asks `kb_search` for a topic-keyword finds entries whose area is about that topic, even when no entry's text mentions the keyword.

## Behavior matrix

| Stimulus | Expected behavior | Scenario |
|----------|-------------------|----------|
| LLM calls `kb_search` for a keyword that appears in an entry's text | Tool returns the entry; LLM cites the marker fact | `tool-direct-text-match` |
| LLM calls `kb_search` for a keyword that appears only in the area's summary/tags | Tool returns entries from that area; LLM cites the marker fact | `tool-finds-via-area-metadata` |
| LLM calls `kb_search` for a keyword that matches no area metadata and no entry text | Tool returns "No matches"; LLM does NOT fabricate the marker | `tool-no-match-no-fabrication` |

The pair `tool-finds-via-area-metadata` (positive) + `tool-no-match-no-fabrication` (negative) is the load-bearing assertion: it distinguishes "search returns the right entries via area metadata" from "search returns everything" or "the LLM hallucinates from the area name appearing somewhere in context."

## Notes

- **Synthetic area per run.** Each scenario creates `e2e-frobnicators-${E2E_RUN_UUID:0:8}` so the assertion is deterministic across re-runs and against any other content the specimen happens to contain.
- **Marker discipline.** The fact text contains a unique `FROB_MARKER_<run-uuid>` so the assertion proves the entry's content reached the LLM via the tool path (not via the area-index in the system prompt).
- **Keyword choice for `tool-finds-via-area-metadata`.** The scenario word (e.g. `frobnicator`) appears in the area summary AND area tags but is conspicuously absent from the entry's text. The entry's text uses a different vocabulary (the marker + a domain-irrelevant fact like "rated for 12.7 hertz") so a search for `frobnicator` only finds the entry via the area-metadata path. If FTS5 were extended to index entry text only, this scenario would still RED.
- **Why a tool-call assertion.** `assert_tool_called "kb_search"` ensures the answer came through the search path, not via auto-injection of the area into the system prompt by the scorer. Without it, the LLM could "find" the marker because the area-scoring path put it there — masking a regression in `kb_search` itself.
- **No `MYKB_DISABLE_TOOLS` here** — this experiment is *about* the tool. The companion area-scoring `scoring-without-tools` scenario exercises the disable knob.
- **L1 anchor lives in `tests/core/db.test.ts`** under the `searchEntries` describe block: a unit test that calls `upsertArea` + `upsertEntry` and asserts `searchEntries(db, '<area-tag-keyword>')` returns the entry. This is the inner-layer counterpart to the L4 scenarios.

## Out of scope

- Phrase queries / FTS5 syntax surface (`AND`/`OR`/`NEAR`). `sanitizeFtsQuery` already AND-joins terms; the tool exposes a simple keyword/phrase query.
- Ranking. We only assert the relevant entry is *in* the results, not that it ranks first.
- Cross-area dedup. If multiple areas have overlapping metadata, the union is fine.
