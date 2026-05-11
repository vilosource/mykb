# Experiment: kb-verify

**Source spec:** `src/tools/kb-verify.ts` — LLM-callable tool that marks an existing entry as verified (replaces `provenance` with `{ status: 'verified', date: <iso> }`; see "pinned behavior" below — no `source` is recorded, contrary to an earlier draft of this spec).
**Implementation under test:** the trust-decay model's promote-half. New entries land with `provenance.status: 'unverified'`; staleness/age decay reduces their score. `kb_verify` is the LLM's path to ratchet an entry up the trust scale by attesting it (e.g., "I just confirmed this fact via reading the source").

## Status

✅ **Implemented.** All three scenarios GREEN against a real Pi runtime, each RED-proven:

| Scenario | GREEN | RED-proof (mutated build) |
|----------|-------|---------------------------|
| `verify-by-id` | 15/15 | `MykbStore.verifyEntry` no-op → no update line appended; resolved provenance stays `unverified` with no date (and the fixture's `source` survives) — 4 assertions flip, `kb_verify` still "fires" |
| `add-then-verify-roundtrip` | 14/14 | same `verifyEntry` no-op → step-1 add still lands but step-2 verify writes nothing; line count stays 1, resolved status `unverified` (3 assertions flip) |
| `verify-unknown-id` | 14/14 | `findEntry` returns a stub instead of throwing → `verifyEntry` appends an update line (count 2) and `kb_verify` reports success instead of the "not found" error (2 assertions flip). The "no mutation" property is also L1-tested. |

**Pinned behavior** (worth a kb gotcha if it ever changes): `verifyEntry` **replaces** provenance wholesale with `{ status: 'verified', date: <iso> }` — it does **not** populate a `source` field, and any prior `source` does not survive the verify.

Tracked in [`docs/experiment-coverage.md`](../../docs/experiment-coverage.md).

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

## Implementation notes (as built)

- **Threading the id across steps.** There is no conversation carry-over between `step` calls — step 2 is a fresh Pi container. So the roundtrip scenario extracts the new entry's id from `areas/<id>/facts.jsonl` *between* the steps (the harness commits step 1's write before returning) and interpolates it into step 2's prompt. (`KB_SESSION_ID` continuity carries the *extension* state — loaded areas, signals — not the chat.)
- **Provenance assertion.** `updateEntry` appends a new JSONL line (it doesn't rewrite), preserving the entry text. So the resolved entry is the *last* line whose text contains the marker; check `.provenance.status == "verified"` and `.provenance.date` non-empty on it. The original line stays at `"unverified"` — that's why a no-op `verifyEntry` is caught by a line-count assertion (1 vs 2) too.
- **The `source` field — pinned NEGATIVE.** `verifyEntry` does *not* populate `provenance.source`, and a pre-existing `source` does *not* survive (provenance is replaced wholesale). `verify-by-id` seeds its fixture with `--source` and asserts the resolved entry has no `source` after verify, so a future change to either behavior is caught.

## Out of scope

- The trust-decay scoring model itself (the way verified entries score higher than unverified, decay over time, etc.) — that's an L4 area-scoring sub-behavior, tracked under [`area-scoring/`](../area-scoring/) if/when it reaches the matrix.
- Multi-LLM verification (two LLMs verifying the same entry) — atomicity is L1.
- Demotion (un-verify): not currently a feature.
