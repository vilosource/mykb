# experiments/kb-verify/scenarios/verify-by-id.sh
#
# Covers the `verify-by-id` row of the kb-verify matrix: given an
# entry's area + id, the LLM calls `kb_verify`, and the entry's
# provenance ratchets from 'unverified' to 'verified' with a fresh date.
#
# kb_verify is the promote-half of the trust-decay model. Its effect is
# invisible to the LLM — it changes provenance metadata, not entry text
# — so the L4 question is purely "does the LLM construct the call from
# context, and does the mutation persist correctly". prepare() seeds a
# fact with the default (unverified) provenance and captures its id;
# stimulate() hands that id to the LLM; observe() reads the *resolved*
# entry (the last JSONL line for that id, since updateEntry appends an
# update line preserving the text) and checks the new provenance.
#
# Pinned current behavior (verifyEntry in knowledge-store.ts): it sets
# `provenance = { status: 'verified', date: <iso> }` — note it does NOT
# populate a `source` field (the matrix's "may auto-populate source"
# guess was wrong; pinned here so a regression is caught either way).
#
# RED-proof: make MykbStore.verifyEntry a no-op (drop the updateEntry
# call) — facts.jsonl keeps its single 'unverified' line, so the
# line-count and resolved-status assertions flip while `kb_verify` still
# "fires". (`npm run bundle:all`, kb-spike new, run; then `git checkout
# -- src/` + rebuild.)
#
# Note: we do NOT set SPIKE_DISABLE_TOOLS — MYKB_DISABLE_TOOLS=1 skips
# registerTools(), un-registering kb_verify too.

intent "Given an entry's area+id, the LLM calls kb_verify; the entry's provenance ratchets to verified with a date"

E2E_RUN_UUID="${E2E_RUN_UUID:-$(date -u +%s%N)}"
FACT_MARKER="VERIFY_MARKER_${E2E_RUN_UUID}"
AREA_ID="e2e-frobnicators-${E2E_RUN_UUID:0:8}"
WS_ID="e2e-vfy-${E2E_RUN_UUID:0:8}"
ENTRY_ID=""

prepare() {
  # Plausible lineage: a workspace where the operator just re-confirmed
  # a fact against its source and wants to ratchet its trust.
  kb init area "$AREA_ID" "Frobnicators" \
    "Frobnicator calibration tolerances and field-replaceable assemblies"
  kb add fact "$AREA_ID" "${FACT_MARKER}: blue frobnicator units operate at 12.7 hertz with a 3% tolerance band" \
    --source "field-manual-rev-c"
  kb work create "$WS_ID" "Verify-by-id demo" --areas "$AREA_ID"
  kb work start "$WS_ID"
  kb work state --phase "implementation" --active "auditing frobnicator facts"
  kb save

  # Capture the just-created entry's id (the kb wrapper has committed
  # the new line to the working tree by now).
  ENTRY_ID="$(jq -r --arg m "$FACT_MARKER" \
    'select(.text != null and (.text | contains($m))) | .id' \
    "$SPIKE_INSTANCE/areas/$AREA_ID/facts.jsonl" | head -1)"
  if [[ -z "$ENTRY_ID" ]]; then
    echo "prepare: BUG — could not find entry id for marker $FACT_MARKER" >&2
    return 1
  fi
  # Sanity: it starts unverified.
  local start_status
  start_status="$(grep -F "$FACT_MARKER" "$SPIKE_INSTANCE/areas/$AREA_ID/facts.jsonl" \
    | tail -1 | jq -r '.provenance.status')"
  if [[ "$start_status" != "unverified" ]]; then
    echo "prepare: BUG — fixture entry is '$start_status', expected 'unverified'" >&2
    return 1
  fi
}

stimulate() {
  step "verify-entry" --prompt "Mark a knowledge entry as verified by calling the kb_verify tool (a registered tool, not a shell command): area set to exactly '${AREA_ID}', id set to exactly '${ENTRY_ID}'. Use ONLY the kb_verify tool — do not use bash, read, write, edit, kb_add, kb_work_journal, kb_work_state, kb_work_note, or any kb_search/kb_load/kb_list tool. After the tool returns, just say 'done'."
}

observe() {
  # The tool path was actually used.
  assert_tool_called "kb_verify"
  assert_no_tool_calls "kb_search"
  assert_no_tool_calls "kb_load"
  assert_no_tool_calls "kb_list"
  assert_no_tool_calls "kb_add"
  assert_no_tool_calls "kb_work_journal"
  assert_no_tool_calls "kb_work_state"
  assert_no_tool_calls "kb_work_note"
  assert_no_tool_calls "bash"

  # An update line was appended for the entry (was 1 line; now 2).
  assert_branch_diff_contains "areas/${AREA_ID}/facts.jsonl"
  assert_jsonl_count "areas/${AREA_ID}/facts.jsonl" 2

  # The resolved entry (last JSONL line for this marker) is now verified
  # with a date, and still carries the marker text.
  local last_line prov_status prov_date prov_source
  last_line="$(grep -F "$FACT_MARKER" "$SPIKE_INSTANCE/areas/$AREA_ID/facts.jsonl" | tail -1)"
  prov_status="$(printf '%s' "$last_line" | jq -r '.provenance.status // empty')"
  prov_date="$(printf '%s' "$last_line" | jq -r '.provenance.date // empty')"
  prov_source="$(printf '%s' "$last_line" | jq -r '.provenance.source // empty')"

  if [[ "$prov_status" == "verified" ]]; then _spike_assert_pass
  else _spike_assert_fail "verify-by-id: resolved provenance.status is '$prov_status', expected 'verified'"; fi

  if [[ -n "$prov_date" ]]; then _spike_assert_pass
  else _spike_assert_fail "verify-by-id: resolved provenance.date is empty after verify"; fi

  # Pinned: verifyEntry replaces provenance wholesale — no source field
  # survives. If a future change starts preserving/populating it, this
  # flips and the matrix gets revisited.
  if [[ -z "$prov_source" ]]; then _spike_assert_pass
  else _spike_assert_fail "verify-by-id: resolved provenance.source is '$prov_source', expected absent"; fi

  assert_step_status_is "completed"
}
