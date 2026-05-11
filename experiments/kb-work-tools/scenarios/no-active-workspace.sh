# experiments/kb-work-tools/scenarios/no-active-workspace.sh
#
# The shared negative for the kb-work-tools matrix: with no active
# workspace, the kb_work_* tools must error gracefully — return a clean
# "no active workspace" message and write nothing — rather than crash,
# pick a workspace arbitrarily, or half-create one.
#
# prepare() creates NO workspace; scenario.sh has already cleared the
# inherited workspaces/.active, so getActiveWorkspaceId() returns
# undefined inside the Pi container (KB_SESSION_ID is set but there's no
# session file, and now no .active fallback either — see GH issue #5).
# Each kb_work_* tool's first act is `if (!activeId) return <error>`, so
# the contract is "the LLM tries the tool, gets the error, relays it,
# and nothing on disk changed".
#
# We probe via kb_work_journal — one tool is enough; all three share the
# same `if (!activeId)` guard (the L1 tests cover each individually).
#
# "No partial mutation" is asserted via assert_no_branch_diff_match
# rather than assert_branch_diff_empty: the harness commits its own
# .e2e-steps/ files and the cleared workspaces/.active onto the scenario
# branch, so the diff is never literally empty — but no workspace.json /
# journal.jsonl / notes.jsonl should appear in it.
#
# Note: we do NOT set SPIKE_DISABLE_TOOLS — MYKB_DISABLE_TOOLS=1 skips
# registerTools() entirely, which would un-register kb_work_journal too
# (the tool whose error path we're testing).

intent "No active workspace -> kb_work_journal returns a graceful error and writes nothing; the LLM relays it"

E2E_RUN_UUID="${E2E_RUN_UUID:-$(date -u +%s%N)}"
NOOP_MARKER="NOOP_MARKER_${E2E_RUN_UUID}"

prepare() {
  # Deliberately empty: no `kb work create`, no `kb work start`. The
  # brain still has the specimen's other workspaces, but none is active
  # (scenario.sh removed workspaces/.active).
  :
}

stimulate() {
  step "try-journal" --prompt "Record this milestone in the workspace journal by calling the kb_work_journal tool (a registered tool, not a shell command) with text exactly: ${NOOP_MARKER}: finished the rate-limiter middleware. Call the tool even if you suspect there is no active workspace — I want to know exactly what it reports back. Use ONLY the kb_work_journal tool — do not use bash, read, write, edit, or any other kb_* tool, and do not try to create or activate a workspace. After the tool returns, report in one short sentence what it told you."
}

observe() {
  # The LLM actually went through the tool path (not "I'll just tell you
  # there's no workspace" without calling it).
  assert_tool_called "kb_work_journal"
  # No fallbacks, no workaround tools, no bash.
  assert_no_tool_calls "kb_search"
  assert_no_tool_calls "kb_load"
  assert_no_tool_calls "kb_list"
  assert_no_tool_calls "kb_work_state"
  assert_no_tool_calls "kb_work_note"
  assert_no_tool_calls "bash"

  # The graceful-error message surfaced to the LLM and it relayed it.
  # The tool returns "No active workspace. Use `kb work activate <id>` first."
  assert_llm_contains_any "active workspace" "No active" "no workspace"

  # Nothing was written: the marker never reached disk, and no workspace
  # file of any kind appears in the branch diff.
  assert_no_branch_diff_match 'workspaces/.+/(journal|notes)\.jsonl$'
  assert_no_branch_diff_match 'workspaces/.+/workspace\.json$'

  assert_step_status_is "completed"
}
