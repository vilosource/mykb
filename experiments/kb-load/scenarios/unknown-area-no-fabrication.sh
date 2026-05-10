# experiments/kb-load/scenarios/unknown-area-no-fabrication.sh
#
# Negative control. When the LLM calls kb_load with a nonexistent
# area-id, the tool returns "No entries found" and the LLM does not
# fabricate a marker.
#
# Why this scenario exists:
#   The behavior matrix needs a paired negative for basic-load.
#   Without it, a "fix" that returned ALL entries on every kb_load
#   call (regardless of area-id) would still pass the positive
#   scenarios. This guards against that failure mode.
#
#   It also catches the more subtle regression where kb_load's
#   "No entries" message changes shape in a way that confuses the
#   LLM into hallucinating from area-index context — by pinning the
#   LLM-output assertion to NOT contain the marker, we catch that.

intent "kb_load returns no-entries on unknown area; LLM does not fabricate"

E2E_RUN_UUID="${E2E_RUN_UUID:-$(date -u +%s%N)}"
FROB_MARKER="FROB_MARKER_${E2E_RUN_UUID}"
REAL_AREA_ID="e2e-frobnicators-${E2E_RUN_UUID:0:8}"
# An area-id no real area can satisfy — per-run nonce.
FAKE_AREA_ID="e2e-nonexistent-${E2E_RUN_UUID:0:8}"

prepare() {
  # Set up a real area with the marker. This is important: if the
  # LLM "helpfully" picks a real area-id when the prompt's id is
  # invalid, we want to detect that — the marker is in REAL_AREA_ID.
  # The negative assertion (marker NOT present) catches the LLM
  # silently substituting REAL_AREA_ID for FAKE_AREA_ID.
  kb init area "$REAL_AREA_ID" "Frobnicators" \
    "Frobnicator calibration tolerances and field-replaceable assemblies" \
    --tags frobnicator,calibration
  kb add fact "$REAL_AREA_ID" "${FROB_MARKER}: blue units are rated for 12.7 hertz with a 3% tolerance band." \
    --tags spec,hertz

  kb work create frob-demo "Frobnicator lookup" --areas "$REAL_AREA_ID"
  kb work start frob-demo
  kb save
}

stimulate() {
  # Tell the LLM exactly what area-id to use, even though it's
  # nonexistent. Forbid fallback tools so the LLM can't switch to
  # kb_search and find the marker that way.
  step "load-nonexistent" --prompt "Use ONLY the kb_load tool with area '${FAKE_AREA_ID}'. Do not use kb_search or kb_list, and do not substitute a different area-id. Report exactly what the tool returned. If the tool reports no entries found, say 'NO_ENTRIES_FOUND' and nothing else."
}

observe() {
  # Tool path was used.
  assert_tool_called    "kb_load"
  assert_no_tool_calls  "kb_search"
  assert_no_tool_calls  "kb_list"
  # The marker fact must NOT appear — that would mean either kb_load
  # returned everything regardless of area-id, or the LLM substituted
  # a real area-id, or it fabricated from area-index context. Each
  # is a regression worth catching.
  assert_llm_not_contains "$FROB_MARKER"
  assert_step_status_is "completed"
}
