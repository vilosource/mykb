# Experiment: work-checkpoint

**Source spec:** `src/cli/cli.ts:687` (the `kb work checkpoint` command), `src/core/workspace.ts:checkpoint()` (the storage method that atomically applies all four sub-updates).
**Implementation under test:** the `LLM-as-extractor` flow described in the parent `CLAUDE.md`'s "Checkpoint — non-blocking session capture" section. The user (or an outer agent) types `kb work checkpoint`; an LLM in a Pi container reads conversation context, emits structured JSON; that JSON is piped to `kb work checkpoint`; the workspace is mutated atomically (journal append + state patch + handoff overwrite + knowledge entry inserts).

## Intent

This is the most ambitious matrix in this branch — it tests an **LLM-as-extractor** flow rather than an LLM-as-respondent flow. Where every other experiment asserts on what the LLM *says* in response to a prompt, this experiment asserts on the **brain state changes** that result from piping the LLM's structured output to a CLI command.

The contract under test is a chain:

1. LLM reads a conversation (passed via prompt) describing what's happened in a session.
2. LLM emits JSON conforming to `kb work checkpoint`'s input schema (`{journal?, handoff?, state?, knowledge?[]}`).
3. The harness pipes the JSON to `kb work checkpoint` against the experiment's brain instance.
4. The brain mutates: journal gets a new entry, state fields update, knowledge entries land in the right areas.

A regression at any link breaks the contract: a verbose LLM that wraps JSON in markdown breaks the pipe; a JSON-aware LLM that hallucinates fields creates phantom journal entries; a `kb work checkpoint` that loses fields silently means the workspace doesn't learn.

Layer 1 unit tests cover `storage.checkpoint()` directly with hand-crafted JSON. This experiment adds the load-bearing piece: **the LLM can actually produce checkpoint-shaped JSON from a real-shape conversation prompt, and the resulting brain mutations are correct.**

## Behavior matrix

| Stimulus | Expected behavior | Scenario |
|----------|-------------------|----------|
| Conversation contains a clear journal-worthy milestone | LLM emits `{journal: "..."}` (raw JSON, no markdown). Checkpoint applies. Workspace `journal.jsonl` has the new entry containing a marker. | `journal-extraction` |
| Conversation establishes a fact in a known area | LLM emits `{knowledge: [{type: 'fact', area, text}]}`. Checkpoint applies. Area's `facts.jsonl` has the entry. | `knowledge-extraction` |
| Conversation is trivial — nothing checkpoint-worthy | LLM emits `{}` (or all empty fields). Checkpoint reports "nothing to update". Workspace state is unchanged. | `empty-conversation-no-fabrication` |

The pair `journal-extraction` (positive) + `empty-conversation-no-fabrication` (negative) bounds the LLM's behavior: it captures real milestones and refuses to fabricate when nothing happened. `knowledge-extraction` is the integration regression guard that proves the JSON → multiple-entries path works for the most operationally important field.

## Notes

- **Synthetic workspace + area per run.** Each scenario creates `e2e-checkpoint-${E2E_RUN_UUID:0:8}` (workspace) and where applicable an `e2e-frobnicators-${E2E_RUN_UUID:0:8}` area, so assertions are deterministic across re-runs.
- **Marker discipline.** Markers are placed in the *prompt* (the synthetic conversation text). The LLM must transcribe the marker into the emitted JSON. Assertions then check the brain mutation contains the marker. This pins the full chain — a regression at any link drops the marker.
- **JSON purity prompt.** The prompt explicitly asks for "raw JSON only, no markdown code fences, no explanation". Without this, LLMs habitually wrap output in ```` ```json ```` blocks, breaking the pipe. The scenarios trim defensively (strip leading/trailing whitespace + optional code-fence) before piping, so a borderline LLM still satisfies the assertion — the test is about the data, not the formatting tolerance.
- **Pipe via the captured CLI.** `kb work checkpoint <<< "$json"` uses bash's here-string to feed stdin into the `kb()` wrapper, which forwards to the per-experiment captured `cli.js`. The methodology's boundary rule is preserved: scenarios call kb only via the captured artifact, never the host.
- **Two-step structure.** Step 1 establishes the active workspace (so checkpoint has somewhere to write). Step 2 does the LLM extraction. Step 1 is via `kb work create/start` in `prepare()` (no LLM); only step 2 is a `step` call. The conversation context is described in the step-2 prompt itself rather than accumulated across earlier `step` calls — the methodology's path-isolation lesson (FYSqWj10) prevents the LLM from picking up the conversation from `<mykb-areas>` or `<mykb-workspace>` blocks.

## Out of scope

- **Malformed JSON / parse errors.** Hard to force reliably from a competent LLM; the parse-failure path is L1-tested directly via `cli.test.ts`'s checkpoint cases.
- **Concurrent checkpoints.** Two LLMs writing to the same workspace at once would test `storage.checkpoint()`'s atomicity, which is L1.
- **Handoff overwrite semantics.** Distinct from journal-append; covered by the `handoff` matrix already.
- **State patch field validation.** The known-keys check (`phase`, `active`, `blocked`, `next`) is L1-tested via the CLI command's argument parsing.
- **Tool-call assertions.** `kb work checkpoint` is invoked from the operator side after the LLM's response; the LLM doesn't call any kb tool to produce JSON. So `assert_tool_called` is meaningless here. The `assert_no_tool_calls ""` guard remains useful — the prompt explicitly forbids tool use, and any tool fire would mean the LLM took a side-channel rather than answering from the prompt content.

## Why this matters at L4

`kb work checkpoint` is the primary mechanism by which a long Claude Code session captures itself into the brain. If the LLM can't produce checkpoint-shaped JSON reliably from natural conversation context, the entire "non-blocking session capture" workflow described in the project's CLAUDE.md is theatre. This matrix is the regression guard for that workflow.
