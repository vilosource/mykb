# experiments/area-scoring/scenarios/kb-list-shows-tags.sh
#
# Outside-in scenario for the follow-up gap that init-area-tags.sh
# surfaced: tags can be set on areas, but no LLM-facing surface (kb_list,
# kb_search, kb_load output) includes them. Discoverability of an area
# by tag falls entirely on the scorer's word overlap, which is
# non-deterministic against a real specimen with 55+ competing areas.
#
# This scenario specifies the contract: 'kb_list shall include each area's
# tags in its output, so an LLM asked about a tagged area can answer
# deterministically via the tool, without depending on scoring luck.'
#
# Why this fails today even though init-area-tags passed:
#   - init-area-tags has the tag word in the FACT TEXT, so scoring puts
#     the area into context and the LLM quotes the fact.
#   - Here we deliberately do NOT mention the tag in any fact or
#     summary the LLM can see. The only place the tag lives is in
#     area metadata (area.json -> manifest.json -> AreaMetadata.tags).
#     The kb_list tool today renders only id+summary, so the LLM has
#     no path to learn the tag.
#   - The scorer might still pick the area (tag overlap == 1), and the
#     LLM might infer from injected entries — but the entries don't
#     mention the tag, so the LLM cannot answer 'which area is tagged X'.

intent "kb_list output exposes each area's tags so the LLM can answer 'which area is tagged X'"

E2E_RUN_UUID="${E2E_RUN_UUID:-$(date -u +%s%N)}"
# Made-up word: zero overlap with any real ~/.mykb area summary or tag.
TAG_PROBE="zappquark${E2E_RUN_UUID:0:6}"
AREA_ID="e2e-listed-${E2E_RUN_UUID:0:8}"

prepare() {
  # Summary deliberately mentions nothing the prompt will hint at,
  # and the fact text deliberately does NOT mention the tag word —
  # so the only surface that could deliver the tag-to-area mapping
  # to the LLM is kb_list itself.
  kb init area "$AREA_ID" "Listed Demo" "A placeholder area for tool-output validation" \
    --tags "$TAG_PROBE,calibration"
  kb add fact "$AREA_ID" "A fact about generic placeholder content."
  kb save
}

stimulate() {
  # Point the LLM at the area index explicitly. Earlier looser phrasing
  # ("look at my knowledge base areas") led to LLM variance — the model
  # would sometimes answer 'none' even though the index in its system
  # prompt clearly listed the tag. Naming the surface (the mykb-areas
  # section) gets a deterministic answer.
  step "ask-tagged" --prompt "Look at the <mykb-areas> section of your system context. Reply with exactly one area-id (no other text): the area whose tags list includes '$TAG_PROBE'."
}

observe() {
  assert_llm_contains   "$AREA_ID"
  assert_step_status_is "completed"
}
