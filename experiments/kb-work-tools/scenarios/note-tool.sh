# experiments/kb-work-tools/scenarios/note-tool.sh
#
# Covers the `note-tool` row of the kb-work-tools matrix: the LLM, told
# to file a tagged triage note, calls the `kb_work_note` tool, and the
# active workspace's notes.jsonl gains the entry with its tag.
#
# Structurally a twin of journal-tool — the only differences are the
# tool under test (kb_work_note vs kb_work_journal), the target file
# (notes.jsonl vs journal.jsonl), and the extra tag assertion (note
# entries carry a `tags` array; journal entries don't).
#
# The active workspace is created+started in prepare() (scenario.sh
# clears any inherited workspaces/.active first; the Pi container has
# KB_SESSION_ID set but no session file, so getActiveWorkspaceId() falls
# back to .active — see GH issue #5). The marker text + tag are in the
# prompt; we assert they land in notes.jsonl on disk.
#
# RED-proof: make wsStorage.appendNote a no-op (return a fake id without
# writing) — the tool still "fires" but notes.jsonl is never created, so
# the file-state assertions fail.
#
# Note: we do NOT set SPIKE_DISABLE_TOOLS — MYKB_DISABLE_TOOLS=1 skips
# registerTools() entirely, which would un-register kb_work_note too.
# Fallback prevention is by the prompt + assert_no_tool_calls, the same
# way journal-tool / kb-load/basic-load handle it.

intent "The LLM files a tagged triage note via the kb_work_note tool; the active workspace's notes.jsonl gains the marker entry with the tag"

E2E_RUN_UUID="${E2E_RUN_UUID:-$(date -u +%s%N)}"
NOTE_MARKER="NOTE_MARKER_${E2E_RUN_UUID}"
WS_ID="e2e-nt-${E2E_RUN_UUID:0:8}"

prepare() {
  # Plausible workflow lineage: an active workspace mid-task. The LLM is
  # about to file a triage note into it via kb_work_note.
  kb work create "$WS_ID" "Note-tool demo"
  kb work start "$WS_ID"
  kb work state --phase "implementation" --active "reviewing the auth module"
  kb save
}

stimulate() {
  step "file-note" --prompt "File a tagged triage note in the workspace by calling the kb_work_note tool (a registered tool, not a shell command): text exactly '${NOTE_MARKER}: the token-refresh path is missing a retry', and tags set to a JSON array containing the single string \"bug\". Use ONLY the kb_work_note tool — do not use bash, read, write, edit, kb_work_journal, kb_work_state, or any kb_search/kb_load/kb_list tool. After the tool returns, just say 'done'."
}

observe() {
  # The tool path was actually used.
  assert_tool_called "kb_work_note"
  # No read/search fallbacks, no other workspace-mutating tools, no bash.
  assert_no_tool_calls "kb_search"
  assert_no_tool_calls "kb_load"
  assert_no_tool_calls "kb_list"
  assert_no_tool_calls "kb_work_journal"
  assert_no_tool_calls "kb_work_state"
  assert_no_tool_calls "bash"

  # The entry landed on disk in the active workspace's notes file, with
  # the marker text and the tag.
  assert_branch_diff_contains "workspaces/${WS_ID}/notes.jsonl"
  assert_jsonl_count    "workspaces/${WS_ID}/notes.jsonl" 1
  assert_jsonl_contains "workspaces/${WS_ID}/notes.jsonl" "$NOTE_MARKER"
  assert_jsonl_contains "workspaces/${WS_ID}/notes.jsonl" '"tags":["bug"]'

  assert_step_status_is "completed"
}
