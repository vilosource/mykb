# Experiment: kb-verify

**Source spec:** `src/tools/kb-verify.ts` — LLM-callable tool that marks an existing entry as verified (sets `provenance.status: 'verified'` + records date and source).
**Implementation under test:** the trust-decay model's promote-half. New entries land with `provenance.status: 'unverified'`; staleness/age decay reduces their score. `kb_verify` is the LLM's path to ratchet an entry up the trust scale by attesting it (e.g., "I just confirmed this fact via reading the source").

## Status

🚧 **Scaffolded — scenarios not yet implemented.** Tracked in [`docs/experiment-coverage.md`](../../docs/experiment-coverage.md).

## Intent

`kb_verify` is non-obvious because its effect isn't directly visible to the LLM — it changes provenance metadata, not entry text. The LLM has to (a) decide an entry is worth verifying, (b) call the tool with the right ID, (c) trust that the verification persisted.

Layer 1 covers the happy path: given an entry id, mutate its provenance. The L4 questions:

- Does the LLM correctly identify the entry to verify from context (i.e., when the prompt describes a fact, can the LLM find its id and call kb_verify against it)?
- Does the verification survive: a follow-up `kb_load` shows the verified entry with the new status?
- Does scoring/retrieval treat verified entries differently per the trust-decay model? (May be out of scope until the model is L4-testable.)

## Behavior matrix

| Stimulus | Expected behavior | Scenario |
|----------|-------------------|----------|
| LLM is given an entry id and asked to verify it | Tool fires with the id; entry's `provenance.status` flips to `'verified'`; `provenance.date` updates | `verify-by-id` |
| LLM has just added a fact (via kb_add); now told to verify it | Two-step: add returns the new id, follow-up uses that id with kb_verify | `add-then-verify-roundtrip` |
| LLM is told to verify a nonexistent entry id | Tool errors gracefully; no partial mutation | `verify-unknown-id` |

The roundtrip scenario is the load-bearing one — proves the full add-then-attest workflow that lets a session simultaneously create AND ratchet trust on its own findings.

## Notes (when implementing)

- **Two-step roundtrip** uses cycle 8's KB_SESSION_ID continuity. Step 1: kb_add returns the id → in the captured step JSON's `result` field. Step 2: extract the id and pass it to a kb_verify call.
- **Provenance assertion** — check the JSONL line for the entry; the latest line for that id should have `"provenance":{"status":"verified", "date":"...", "source":"..."}`.
- **The "source" field**: kb_verify should auto-populate it with something like `"verified by LLM during session <id>"`. Check current behavior and pin.

## Out of scope

- The trust-decay scoring model itself (the way verified entries score higher than unverified, decay over time, etc.) — that's an L4 area-scoring sub-behavior, tracked under [`area-scoring/`](../area-scoring/) if/when it reaches the matrix.
- Multi-LLM verification (two LLMs verifying the same entry) — atomicity is L1.
- Demotion (un-verify): not currently a feature.
