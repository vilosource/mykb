# experiments/kb-add/scenarios/add-fact.sh
#
# Covers the `add-fact` row of the kb-add matrix: a session that has
# learned a durable fact about an area calls the `kb_add` tool with
# `type: 'fact'`, and the area's facts.jsonl gains the entry with the
# marker text.
#
# This is the simplest LLM-mutates-the-brain path — the area-level
# analogue of kb-work-tools/journal-tool (which mutates the *workspace*).
# Where `kb work checkpoint` is the batch extractor, `kb_add` is the
# streaming "I just learned X, record it now" tool.
#
# The area is created in prepare() (a plausible session lineage: a
# workspace whose linked area the operator is actively building out).
# The marker text is in the prompt; we assert it lands in
# areas/<id>/facts.jsonl on disk and that the tool path — not bash, not
# kb work checkpoint — is what wrote it.
#
# RED-proof: make MykbStore.persistEntry a no-op for facts (return a fake
# id without appendEntry/dbUpsert) — the tool still "fires" and reports
# success, but facts.jsonl is never written, so the file-state
# assertions flip. Simplest reliable mutation: in src/core/knowledge-store.ts
# change `addEntry` for the 'fact' branch to `return generateId();` before
# persistEntry. (`npm run bundle:all`, kb-spike new, run; then `git
# checkout -- src/` + rebuild.)
#
# Note: we do NOT set SPIKE_DISABLE_TOOLS — MYKB_DISABLE_TOOLS=1 skips
# registerTools() entirely, which would un-register kb_add too. Fallback
# prevention is by the prompt + assert_no_tool_calls, the same way
# kb-work-tools/journal-tool and kb-load/basic-load handle it.

intent "The LLM records a durable fact via the kb_add tool; the area's facts.jsonl gains the marker entry"

E2E_RUN_UUID="${E2E_RUN_UUID:-$(date -u +%s%N)}"
FACT_MARKER="FACT_MARKER_${E2E_RUN_UUID}"
AREA_ID="e2e-frobnicators-${E2E_RUN_UUID:0:8}"
WS_ID="e2e-add-${E2E_RUN_UUID:0:8}"

prepare() {
  # Plausible workflow lineage: a workspace mid-task whose linked area
  # the operator is fleshing out. The LLM is about to record a fact it
  # learned this session into that area via kb_add.
  kb init area "$AREA_ID" "Frobnicators" \
    "Frobnicator calibration tolerances and field-replaceable assemblies"
  kb work create "$WS_ID" "Add-fact demo" --areas "$AREA_ID"
  kb work start "$WS_ID"
  kb work state --phase "implementation" --active "documenting frobnicator specs"
  kb save
}

stimulate() {
  step "record-fact" --prompt "Record a durable fact in the knowledge base by calling the kb_add tool (a registered tool, not a shell command): area set to exactly '${AREA_ID}', type set to exactly 'fact', and text set to exactly '${FACT_MARKER}: blue frobnicator units operate at 12.7 hertz with a 3% tolerance band'. Use ONLY the kb_add tool — do not use bash, read, write, edit, kb_work_journal, kb_work_state, kb_work_note, kb_verify, or any kb_search/kb_load/kb_list tool. After the tool returns, just say 'done'."
}

observe() {
  # The tool path was actually used.
  assert_tool_called "kb_add"
  # No read/search fallbacks, no other brain-mutating tools, no bash.
  assert_no_tool_calls "kb_search"
  assert_no_tool_calls "kb_load"
  assert_no_tool_calls "kb_list"
  assert_no_tool_calls "kb_verify"
  assert_no_tool_calls "kb_work_journal"
  assert_no_tool_calls "kb_work_state"
  assert_no_tool_calls "kb_work_note"
  assert_no_tool_calls "bash"

  # The entry landed on disk in the area's facts file, with the marker.
  assert_branch_diff_contains "areas/${AREA_ID}/facts.jsonl"
  assert_jsonl_count    "areas/${AREA_ID}/facts.jsonl" 1
  assert_jsonl_contains "areas/${AREA_ID}/facts.jsonl" "$FACT_MARKER"

  assert_step_status_is "completed"
}
