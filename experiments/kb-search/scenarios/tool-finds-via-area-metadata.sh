# experiments/kb-search/scenarios/tool-finds-via-area-metadata.sh
#
# RED-driver scenario for the kb_search experiment. Probes the
# FTS-doesn't-index-area-tags gap: a search whose keyword appears only
# in an area's summary/tags returns nothing under the current schema,
# even though every entry in that area is unambiguously about the
# topic.
#
# Setup:
#   - Area summary contains the keyword 'frobnicator' and area-level
#     tags include 'frobnicator'.
#   - The area's only entry is a marker fact whose TEXT and entry-tags
#     deliberately do NOT mention frobnicator (so the entry can only be
#     reached via an area-metadata index).
#
# Stimulus:
#   - LLM is told to search for 'frobnicator' via kb_search and quote
#     the matching fact.
#
# Expected (post-fix):
#   - kb_search returns the marker fact (via the new areas_fts path).
#   - LLM cites the marker.
#
# Currently RED: entries_fts indexes (id, text, tags, area-id) only;
# 'frobnicator' is in none of those for the entry, so MATCH returns
# zero rows.

intent "kb_search returns entries when the query matches only area summary/tags"

E2E_RUN_UUID="${E2E_RUN_UUID:-$(date -u +%s%N)}"
FROB_MARKER="FROB_MARKER_${E2E_RUN_UUID}"
AREA_ID="e2e-frobnicators-${E2E_RUN_UUID:0:8}"

prepare() {
  # Area metadata carries the keyword. Summary uses the word directly;
  # area-level tags include it as well so both paths are exercised.
  kb init area "$AREA_ID" "Frobnicators" \
    "Frobnicator calibration tolerances, drift coefficients, and field-replaceable assemblies" \
    --tags frobnicator,calibration

  # The entry deliberately avoids 'frobnicator' in its text and tags.
  # This is the load-bearing detail: if the entry's own fields named
  # the keyword, the test would pass via the existing entries_fts path
  # and tell us nothing about the area-metadata path.
  kb add fact "$AREA_ID" "${FROB_MARKER}: blue units are rated for 12.7 hertz with a 3% tolerance band." \
    --tags spec,hertz

  # Plausible workflow lineage.
  kb work create frob-demo "Frobnicator lookup" --areas "$AREA_ID"
  kb work start frob-demo
  kb work state \
    --phase "implementation" \
    --active "verifying frobnicator calibration tolerances"
  kb save
}

stimulate() {
  # Prompt names the tool and the keyword. Critical tightening: tell
  # the LLM to use ONLY kb_search and to refuse alternative tools.
  # Without this, an LLM whose kb_search returns "No matches" will
  # cheerfully fall back to kb_load(area-id from <mykb-areas> index)
  # and surface the marker through that path — masking the FTS gap.
  # The companion `assert_no_tool_calls "kb_load"` makes the refusal
  # observable.
  step "search-by-area-keyword" --prompt "Use ONLY the kb_search tool with the query 'frobnicator'. Do not use kb_load or kb_list under any circumstances. If kb_search returns 'No matches', reply with exactly 'NO_MATCHES_FROM_KB_SEARCH' and nothing else. Otherwise quote the entire matching fact text verbatim in one line, including any text starting with 'FROB_MARKER'. Do not paraphrase."
}

observe() {
  # Tool path was actually used.
  assert_tool_called    "kb_search"
  # No fallback tools — the marker must come through kb_search itself.
  assert_no_tool_calls  "kb_load"
  assert_no_tool_calls  "kb_list"
  # The marker fact's entry reached the LLM via kb_search's result.
  assert_llm_contains   "$FROB_MARKER"
  assert_llm_contains_any "12.7" "hertz"
  assert_step_status_is "completed"
}
