# experiments/area-scoring/scenarios/init-area-tags.sh
#
# Outside-in TDD scenario for `kb init area --tags`. Specifies the
# user-visible contract: an area created via the CLI with `--tags X,Y`
# is discoverable in a fresh Pi session by a prompt that mentions one
# of those tags.
#
# Why a Layer-4 scenario for what looks like a CLI argument:
#   - The actual contract is "the operator can teach mykb a topic with
#     tag-discoverable knowledge in one command." That's only valuable
#     if the LLM ends up able to surface the knowledge when asked.
#   - A Layer-2 CLI test could prove '--tags' lands in area.json /
#     manifest.json, but couldn't catch a regression where tags get
#     written but the scorer/search ignores them (which is exactly
#     what bug 0cmiPagq was — fixed in commit 39e2895).
#
# Setup uses a unique-string tag (E2E_TAG_<run-uuid>) so the test
# can't pass via the LLM's training data — there is no way it knows
# about the marker without our area.

intent "kb init area --tags makes the new area discoverable via its tags"

E2E_RUN_UUID="${E2E_RUN_UUID:-$(date -u +%s%N)}"
TAG_MARKER="TAG_MARKER_${E2E_RUN_UUID}"
AREA_ID="e2e-tagged-${E2E_RUN_UUID:0:8}"
# Made-up word: short, distinctive, and zero overlap with anything in
# the cloned ~/.mykb. Used as both the tag and the prompt keyword — so
# scoring only matches on the tag overlap, not on summary text or
# unrelated context noise. This is the cleanest probe of tag-driven
# scoring against a real specimen with 55+ existing areas competing
# for the token budget.
UNIQUE_TAG="zynnoflux${E2E_RUN_UUID:0:6}"

prepare() {
  # Summary is intentionally generic and uses words unlikely to appear
  # in the prompt — so the area only scores when the prompt overlaps
  # with the tag itself.
  kb init area "$AREA_ID" "Tagged Demo" "A demo placeholder description" \
    --tags "$UNIQUE_TAG"
  # Include the tag word in the fact so the LLM can bridge from
  # "what about zynnoflux?" (prompt) to the marker (fact text). The
  # scorer puts the area into context via tag overlap; the fact's text
  # is what the LLM actually quotes back.
  kb add fact "$AREA_ID" "Marker ${TAG_MARKER}: ${UNIQUE_TAG} is the keyword for this calibration fact."
  kb save
}

stimulate() {
  # Single-shot prompt mentioning only the unique tag word. Scoring:
  # the prompt's token "$UNIQUE_TAG" matches this area's tag (+1) so
  # the scorer ranks the area into the context-injection budget. The
  # 'quote verbatim' framing pins the assertion to marker presence
  # (the LLM otherwise summarizes the fact and the marker is lost).
  step "ask-tag" --prompt "Reply in one line. My knowledge base has a fact about ${UNIQUE_TAG}. Quote that fact verbatim — including any text starting with 'Marker'."
}

observe() {
  assert_llm_contains   "$TAG_MARKER"
  assert_step_status_is "completed"
}
