# experiments/kb-add/scenarios/add-to-unknown-area.sh
#
# Boundary case of the kb-add matrix: the LLM is told to record a fact
# in an area that does not exist. Current behavior — pinned here so a
# regression that changes it is caught — is **auto-create**:
# `executeKbAdd` → `store.addFact` → `persistEntry` → `appendEntry`,
# and `appendEntry` does `if (!areaExists(...)) { createArea(...);
# regenerateManifest(...) }` (src/core/store.ts). So the area springs
# into being with just `area.json` + the one `facts.jsonl` line, and the
# tool returns success ("Added fact to **<area>** (id: …). Area now has
# 1 entries.").
#
# This is the *intentional* policy (it mirrors `kb add fact <newarea>`
# at the CLI). The scenario is not a negative — there is no graceful
# error here, because there is no error. It documents that `kb_add`
# never fails on an unknown area, which is non-obvious and worth a
# regression guard (and a kb gotcha if it ever changes).
#
# RED-proof: in src/core/store.ts appendEntry, change the auto-create
# branch to `throw new Error(...)` instead of createArea — the tool then
# returns an error, the area dir never appears, and the file-state +
# manifest assertions flip. (`npm run bundle:all`, kb-spike new, run;
# then `git checkout -- src/` + rebuild.)
#
# Note: we do NOT set SPIKE_DISABLE_TOOLS — MYKB_DISABLE_TOOLS=1 skips
# registerTools(), un-registering kb_add.

intent "kb_add to a nonexistent area auto-creates the area (pinned policy) and the fact lands"

E2E_RUN_UUID="${E2E_RUN_UUID:-$(date -u +%s%N)}"
NEW_AREA_MARKER="NEW_AREA_MARKER_${E2E_RUN_UUID}"
# The area name is itself unique-per-run; it must NOT exist in the
# cloned specimen. (e2e-* is reserved for synthetic areas.)
NEW_AREA_ID="e2e-newarea-${E2E_RUN_UUID:0:8}"
WS_ID="e2e-newarea-ws-${E2E_RUN_UUID:0:8}"

prepare() {
  # No `kb init area` for NEW_AREA_ID — the whole point is that it
  # doesn't exist yet. We do give the session a plausible workspace so
  # the lineage is realistic (an operator who decides mid-session that a
  # fact deserves a brand-new area).
  kb work create "$WS_ID" "New-area demo"
  kb work start "$WS_ID"
  kb work state --phase "implementation" --active "carving out a new knowledge area"
  kb save

  # Sanity: the area really must not exist in the instance yet.
  if [[ -d "$SPIKE_INSTANCE/areas/$NEW_AREA_ID" ]]; then
    echo "prepare: BUG — area $NEW_AREA_ID already exists in the instance" >&2
    return 1
  fi
}

stimulate() {
  step "record-into-new-area" --prompt "Record a durable fact in the knowledge base by calling the kb_add tool (a registered tool, not a shell command): area set to exactly '${NEW_AREA_ID}' (this area does not exist yet — that is intentional, the tool should create it), type set to exactly 'fact', and text set to exactly '${NEW_AREA_MARKER}: the calibration jig must rest 20 minutes before first use'. Use ONLY the kb_add tool — do not use bash, read, write, edit, kb work commands, or any other kb_* tool, and do NOT try to create the area first by any other means. After the tool returns, report in one short sentence what it told you."
}

observe() {
  # The tool path was used (not a workaround that creates the area some
  # other way).
  assert_tool_called "kb_add"
  assert_no_tool_calls "kb_search"
  assert_no_tool_calls "kb_load"
  assert_no_tool_calls "kb_list"
  assert_no_tool_calls "kb_verify"
  assert_no_tool_calls "bash"

  # The tool reported success (it does NOT error on an unknown area).
  assert_llm_contains_any "Added" "added" "Area now has" "$NEW_AREA_ID"

  # The area was auto-created: area.json exists, facts.jsonl has the one
  # marker line, and the manifest was regenerated to include it.
  assert_branch_diff_contains "areas/${NEW_AREA_ID}/area.json"
  assert_branch_diff_contains "areas/${NEW_AREA_ID}/facts.jsonl"
  assert_jsonl_count    "areas/${NEW_AREA_ID}/facts.jsonl" 1
  assert_jsonl_contains "areas/${NEW_AREA_ID}/facts.jsonl" "$NEW_AREA_MARKER"
  assert_branch_diff_contains "manifest.json"
  assert_state_file_field "manifest.json" \
    ".areas | map(select(.id == \"${NEW_AREA_ID}\")) | length" "1"

  assert_step_status_is "completed"
}
