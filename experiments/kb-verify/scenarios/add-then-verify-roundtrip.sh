# experiments/kb-verify/scenarios/add-then-verify-roundtrip.sh
#
# The load-bearing scenario of the kb-verify matrix: the create-and-
# attest workflow, end to end, across two separate Pi containers sharing
# one KB_SESSION_ID.
#
#   step 1  the LLM calls kb_add to record a fact carrying the marker.
#           A fresh id is generated; the entry lands unverified.
#   step 2  a fresh Pi container is handed that id (extracted from the
#           JSONL between steps — there is no conversation carry-over) and
#           told to kb_verify it. The entry's provenance ratchets to
#           verified.
#
# This proves a session can simultaneously create AND ratchet trust on
# its own findings — the pattern a careful agent uses when it both
# discovers a fact and confirms it in the same sitting. verify-by-id
# isolates the verify mutation against a pre-seeded entry; this scenario
# is the integration anchor (the add and the verify, threaded by id).
#
# RED-proof: make MykbStore.verifyEntry a no-op — step 1's add still
# lands (facts.jsonl gets its first line) but step 2's verify writes
# nothing, so the line-count (2) and resolved-status (verified)
# assertions flip. (`npm run bundle:all`, kb-spike new, run; then `git
# checkout -- src/` + rebuild.)
#
# Note: we do NOT set SPIKE_DISABLE_TOOLS — MYKB_DISABLE_TOOLS=1 skips
# registerTools(), un-registering both kb_add and kb_verify.

intent "The LLM adds a fact via kb_add in step 1, then verifies it by id via kb_verify in step 2 — the create-and-attest loop"

E2E_RUN_UUID="${E2E_RUN_UUID:-$(date -u +%s%N)}"
RT_MARKER="VERIFY_RT_MARKER_${E2E_RUN_UUID}"
AREA_ID="e2e-widgets-${E2E_RUN_UUID:0:8}"
WS_ID="e2e-vrt-${E2E_RUN_UUID:0:8}"
ENTRY_ID=""

prepare() {
  # Plausible lineage: a workspace whose linked area the operator is
  # building out and immediately attesting.
  kb init area "$AREA_ID" "Widget tolerances" \
    "Mechanical tolerances and torque specs for the widget assembly line"
  kb work create "$WS_ID" "Add-then-verify demo" --areas "$AREA_ID"
  kb work start "$WS_ID"
  kb work state --phase "implementation" --active "recording and attesting widget specs"
  kb save
}

stimulate() {
  step "add-fact" --prompt "Record a durable fact in the knowledge base by calling the kb_add tool (a registered tool, not a shell command): area set to exactly '${AREA_ID}', type set to exactly 'fact', and text set to exactly '${RT_MARKER}: the M6 widget bolts torque to 9.5 newton-metres on the assembly line'. Use ONLY the kb_add tool — do not use bash, read, write, edit, or any other kb_* tool. After the tool returns, just say 'done'."

  # Extract the new entry's id from the JSONL (the harness committed
  # step 1's write before returning here; no conversation carry-over to
  # step 2 means we have to thread the id ourselves).
  ENTRY_ID="$(jq -r --arg m "$RT_MARKER" \
    'select(.text != null and (.text | contains($m))) | .id' \
    "$SPIKE_INSTANCE/areas/$AREA_ID/facts.jsonl" | head -1)"
  if [[ -z "$ENTRY_ID" ]]; then
    echo "stimulate: BUG — kb_add did not write an entry for marker $RT_MARKER" >&2
    # Still run step 2 with an empty id so observe() records the failure
    # rather than the harness crashing.
  fi

  step "verify-fact" --prompt "Mark a knowledge entry as verified by calling the kb_verify tool (a registered tool, not a shell command): area set to exactly '${AREA_ID}', id set to exactly '${ENTRY_ID}'. Use ONLY the kb_verify tool — do not use bash, read, write, edit, kb_add, or any other kb_* tool. After the tool returns, just say 'done'."
}

observe() {
  # ── Step 1: the add landed via the tool path. SPIKE_LAST_STEP_FILE
  #    points at step 2 in observe(); repoint it for the step-1 checks.
  local _last="$SPIKE_LAST_STEP_FILE"
  SPIKE_LAST_STEP_FILE="$SPIKE_INSTANCE/.e2e-steps/${SPIKE_SCENARIO}/001-add-fact.json"
  assert_tool_called   "kb_add"
  assert_no_tool_calls "kb_verify"
  assert_no_tool_calls "bash"
  SPIKE_LAST_STEP_FILE="$_last"

  # ── Step 2 (current SPIKE_LAST_STEP_FILE): the verify landed via the
  #    tool path, nothing else.
  assert_tool_called   "kb_verify"
  assert_no_tool_calls "kb_add"
  assert_no_tool_calls "kb_search"
  assert_no_tool_calls "kb_load"
  assert_no_tool_calls "kb_list"
  assert_no_tool_calls "bash"

  # ── Disk: one add line + one verify update line for the same entry.
  assert_branch_diff_contains "areas/${AREA_ID}/facts.jsonl"
  assert_jsonl_count "areas/${AREA_ID}/facts.jsonl" 2

  # The resolved entry is verified, carries a date, and still has the
  # marker text from the original add.
  local last_line prov_status prov_date
  last_line="$(grep -F "$RT_MARKER" "$SPIKE_INSTANCE/areas/$AREA_ID/facts.jsonl" | tail -1)"
  prov_status="$(printf '%s' "$last_line" | jq -r '.provenance.status // empty')"
  prov_date="$(printf '%s' "$last_line" | jq -r '.provenance.date // empty')"

  if [[ "$prov_status" == "verified" ]]; then _spike_assert_pass
  else _spike_assert_fail "add-then-verify: resolved provenance.status is '$prov_status', expected 'verified'"; fi

  if [[ -n "$prov_date" ]]; then _spike_assert_pass
  else _spike_assert_fail "add-then-verify: resolved provenance.date is empty after verify"; fi

  assert_step_status_is "completed"
}
