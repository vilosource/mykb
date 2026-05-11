# experiments/kb-verify/scenarios/verify-unknown-id.sh
#
# The negative for the kb-verify matrix: asked to verify an entry id
# that does not exist, kb_verify must error gracefully — return a clean
# "not found" message and write nothing — rather than crash, create the
# entry, or partially mutate the area.
#
# `executeKbVerify` wraps `store.verifyEntry` in try/catch; verifyEntry
# → updateEntry → findEntry throws `EntryNotFoundError` for a missing
# id, and the catch returns `Error: Entry "<id>" not found in area
# "<area>".` So the contract is: the LLM calls the tool, gets the error
# message, relays it, and nothing on disk changed (the area still has
# exactly its one pre-seeded entry — one JSONL line, no update line
# appended).
#
# prepare() seeds one real entry so the *area* exists (an unknown-area
# case would be a different boundary — and kb_verify on an unknown area
# also "entry not found", since findEntry queries that area and finds
# nothing). The id under test is a unique-per-run nonce that cannot
# collide with the real entry or any specimen entry.
#
# RED-proof: make findEntry return a stub entry instead of throwing when
# the id is missing — verifyEntry then appends an update line (line
# count 2) and the tool reports success, so the line-count assertion AND
# the "relayed an error" assertion flip. (`npm run bundle:all`, kb-spike
# new, run; then `git checkout -- src/` + rebuild.) The "no mutation"
# assertion itself is also unit-tested at L1.
#
# Note: we do NOT set SPIKE_DISABLE_TOOLS — MYKB_DISABLE_TOOLS=1 skips
# registerTools(), un-registering kb_verify (the tool whose error path
# we're testing).

intent "kb_verify on a nonexistent entry id returns a graceful 'not found' error and writes nothing; the LLM relays it"

E2E_RUN_UUID="${E2E_RUN_UUID:-$(date -u +%s%N)}"
REAL_MARKER="VERIFY_REAL_${E2E_RUN_UUID}"
# The id under test: a nonce that does not exist anywhere.
BAD_ID="nope-${E2E_RUN_UUID}"
AREA_ID="e2e-arch-${E2E_RUN_UUID:0:8}"
WS_ID="e2e-vbad-${E2E_RUN_UUID:0:8}"

prepare() {
  # The area must exist (with at least one real entry) so this tests the
  # "id not found", not "area not found", boundary — and so we have a
  # baseline line count to check stayed unchanged.
  kb init area "$AREA_ID" "Service architecture" \
    "Topology, transport, and consistency decisions for the ingest service"
  kb add fact "$AREA_ID" "${REAL_MARKER}: the ingest service runs three replicas behind the load balancer"
  kb work create "$WS_ID" "Verify-unknown-id demo" --areas "$AREA_ID"
  kb work start "$WS_ID"
  kb work state --phase "implementation" --active "auditing ingest facts"
  kb save
}

stimulate() {
  step "verify-bad-id" --prompt "Mark a knowledge entry as verified by calling the kb_verify tool (a registered tool, not a shell command): area set to exactly '${AREA_ID}', id set to exactly '${BAD_ID}'. Call the tool even if you suspect that id does not exist — I want to know exactly what it reports back. Use ONLY the kb_verify tool — do not use bash, read, write, edit, kb_add, kb_load, kb_list, kb_search, or any kb_work_* tool, and do not try to look up or create the entry. After the tool returns, report in one short sentence what it told you."
}

observe() {
  # The LLM actually went through the tool path.
  assert_tool_called "kb_verify"
  assert_no_tool_calls "kb_search"
  assert_no_tool_calls "kb_load"
  assert_no_tool_calls "kb_list"
  assert_no_tool_calls "kb_add"
  assert_no_tool_calls "kb_work_journal"
  assert_no_tool_calls "kb_work_state"
  assert_no_tool_calls "kb_work_note"
  assert_no_tool_calls "bash"

  # The graceful-error message surfaced to the LLM and it relayed it.
  # The tool returns: Error: Entry "<id>" not found in area "<area>".
  # (Deliberately NOT accepting "$BAD_ID" as a match here: a RED build
  # where verify *succeeds* on the bad id would have the LLM echo the id
  # too — so matching the id wouldn't distinguish success from failure.
  # "not found" / "Error" only appear on the graceful-error path.)
  assert_llm_contains_any "not found" "Error"

  # Nothing was written: the area still has exactly its one pre-seeded
  # line — no update line appended, no new file.
  assert_jsonl_count "areas/${AREA_ID}/facts.jsonl" 1
  assert_jsonl_contains "areas/${AREA_ID}/facts.jsonl" "$REAL_MARKER"
  # The real entry is still unverified (verify never touched it).
  local real_status
  real_status="$(grep -F "$REAL_MARKER" "$SPIKE_INSTANCE/areas/$AREA_ID/facts.jsonl" | tail -1 | jq -r '.provenance.status // empty')"
  if [[ "$real_status" == "unverified" ]]; then _spike_assert_pass
  else _spike_assert_fail "verify-unknown-id: real entry status is '$real_status', expected 'unverified' (verify leaked onto it)"; fi

  assert_step_status_is "completed"
}
