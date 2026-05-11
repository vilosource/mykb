# Experiment: kb-add

**Source spec:** `src/tools/kb-add.ts` — LLM-callable tool that adds a fact / decision / gotcha / pattern to a named area.
**Implementation under test:** the "LLM mutates the brain mid-session" path. Distinct from `kb work checkpoint` (batch) and `kb_work_*` (workspace-scoped streaming) — `kb_add` writes directly to area-level knowledge.

## Status

✅ **Implemented.** All four scenarios GREEN against a real Pi runtime, each RED-proven:

| Scenario | GREEN | RED-proof (mutated build) |
|----------|-------|---------------------------|
| `add-fact` | 13/13 | `MykbStore.addEntry` skips `persistEntry` (`return entry.id`) → `facts.jsonl` never written (3 file-state assertions flip; `kb_add` still "fires") |
| `add-decision-with-why` | 15/15 | `MykbStore.addDecision` drops the `if (options?.why) … = options.why` line → decision lands but `why` doesn't (the rationale-marker assertion flips; the decision-marker one still passes) |
| `add-then-search-roundtrip` | 16/16 | same `addEntry` no-op → step-1 write never happens, so step-2 `kb_search` returns nothing and the LLM can't surface the entry's content (`9.5`/`newton`/`torque` — none of it is in the prompt). Preferred unambiguous retrieve-side mutation: make `kb-search.ts` `execute` return "No matches." unconditionally. |
| `add-to-unknown-area` | 14/14 | same `addEntry` no-op → the area is never auto-created, so `area.json` / `facts.jsonl` / `manifest.json` never appear (6 assertions flip). Cleaner policy-isolating mutation: make `appendEntry`'s auto-create branch `throw` instead of `createArea`. |

Tracked in [`docs/experiment-coverage.md`](../../docs/experiment-coverage.md).

## Intent

When a Claude Code session discovers a durable fact, decision, gotcha, or pattern about an area, the LLM is expected to call `kb_add` directly. The fact lands in `areas/<id>/<type>s.jsonl` and is searchable via `kb_search` from that point onward.

This is the most direct LLM-mutates-brain path. Layer 1 unit tests cover `executeKbAdd` with hand-crafted params. The L4 question:

- Can the LLM construct a valid `kb_add` call from a natural-language milestone?
- Does the entry land in the right area's right file with the right schema?
- Does a follow-up `kb_search` call (in a later step) find the entry?

The third question is the integration anchor — proves the FTS index updated and the same-session retrieval path works.

## Behavior matrix

| Stimulus | Expected behavior | Scenario |
|----------|-------------------|----------|
| LLM is told to record a fact in a known area | Tool fires with `type: 'fact'`; `facts.jsonl` gains the entry; marker lands in entry text | `add-fact` |
| LLM is told to record a decision with a `why` rationale | Tool fires with `type: 'decision'` and `why` populated; `decisions.jsonl` gains entry preserving the why | `add-decision-with-why` |
| LLM adds a fact, then in a follow-up step searches for the marker | `kb_search` finds the just-added fact (proves FTS sync) | `add-then-search-roundtrip` |
| LLM is told to add a fact to a nonexistent area | Tool errors / area auto-creates per current behavior | `add-to-unknown-area` |

The roundtrip scenario (`add-then-search-roundtrip`) is the load-bearing one — it tests the full closed loop: write → index → retrieve. A regression at any link breaks it.

## Notes (when implementing)

- **Verify auto-create policy first.** `appendEntry` historically auto-creates an area when the name doesn't exist; check current behavior in `cli.ts` and pin it as scenario expected behavior. May need a kb gotcha if the policy is non-obvious.
- **Follow-up step for `add-then-search-roundtrip`** uses cycle 8's file-backed SessionState (automatic via SPIKE_SCENARIO_SESSION_ID). Step 1 = add via tool; step 2 = search and assert.
- **Marker discipline** — the marker lives in the entry text; assert it appears in both the resulting JSONL file AND in the search-result LLM output.

## Out of scope

- Tag validation, provenance defaults, schema discriminators — covered by L1.
- Cross-area dedup — `kb_add` doesn't claim de-duplication; user/AI is responsible.
- Verified-status ratchet — that's the [`kb-verify`](../kb-verify/) matrix.
