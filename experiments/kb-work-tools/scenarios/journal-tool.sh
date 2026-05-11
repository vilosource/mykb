# experiments/kb-work-tools/scenarios/journal-tool.sh
#
# Covers the `journal-tool` row of the kb-work-tools matrix: the LLM,
# told to record a milestone, calls the `kb_work_journal` tool, and the
# active workspace's journal.jsonl gains the entry.
#
# The active workspace is created in prepare() (so workspaces/.active
# points at it — scenario.sh clears any inherited .active first; the Pi
# container has KB_SESSION_ID set but no session file, so it falls back
# to .active, which is now this scenario's workspace). The marker text
# is in the prompt; we assert it lands in journal.jsonl on disk.
#
# RED-proof: make wsStorage.appendJournal a no-op (or executeKbWorkJournal
# skip the append) — the tool still "fires" but journal.jsonl is never
# created/written, so the file-state assertions fail.
#
# Note: we do NOT set SPIKE_DISABLE_TOOLS — MYKB_DISABLE_TOOLS=1 skips
# registerTools() entirely, which would un-register kb_work_journal too
# (it's the tool under test). Fallback prevention is by the prompt
# ("Use ONLY kb_work_journal — do not use ...") + assert_no_tool_calls
# on each forbidden name, the same way kb-load/basic-load.sh handles it.

intent "The LLM records a milestone via the kb_work_journal tool; the active workspace's journal.jsonl gains the marker entry"

E2E_RUN_UUID="${E2E_RUN_UUID:-$(date -u +%s%N)}"
JOURNAL_MARKER="JOURNAL_MARKER_${E2E_RUN_UUID}"
WS_ID="e2e-jt-${E2E_RUN_UUID:0:8}"

prepare() {
  # Plausible workflow lineage: an active workspace mid-task. The LLM is
  # about to record a milestone into it via kb_work_journal.
  kb work create "$WS_ID" "Journal-tool demo"
  kb work start "$WS_ID"
  kb work state --phase "implementation" --active "wiring the rate-limiter"
  kb save
}

stimulate() {
  step "record-milestone" --prompt "Record this milestone in the workspace journal by calling the kb_work_journal tool (a registered tool, not a shell command) with text exactly: ${JOURNAL_MARKER}: finished the rate-limiter middleware. Use ONLY the kb_work_journal tool — do not use bash, read, write, edit, kb_work_state, kb_work_note, or any kb_search/kb_load/kb_list tool. After the tool returns, just say 'done'."
}

observe() {
  # The tool path was actually used.
  assert_tool_called "kb_work_journal"
  # No read/search fallbacks, no other workspace-mutating tools, no bash.
  assert_no_tool_calls "kb_search"
  assert_no_tool_calls "kb_load"
  assert_no_tool_calls "kb_list"
  assert_no_tool_calls "kb_work_state"
  assert_no_tool_calls "kb_work_note"
  assert_no_tool_calls "bash"

  # The entry landed on disk in the active workspace's journal.
  assert_branch_diff_contains "workspaces/${WS_ID}/journal.jsonl"
  assert_jsonl_count    "workspaces/${WS_ID}/journal.jsonl" 1
  assert_jsonl_contains "workspaces/${WS_ID}/journal.jsonl" "$JOURNAL_MARKER"

  assert_step_status_is "completed"
}
