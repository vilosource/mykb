# experiments/journal-auto-inject/scenarios/stale-filter.sh
#
# The negative paired with resume-continuity: journal entries older than
# the 2-day window must NOT surface in the LLM's context. Without this
# test, a regression where the date filter no-ops would produce a
# correct-looking resume-continuity pass while quietly leaking stale
# context into every session.
#
# Setup writes entries with a backdated `date` field directly to
# journal.jsonl — `kb work journal` always stamps today. The file shape
# (one JSON object per line, fields {date,id,text}) matches what
# appendJournal produces.

intent "Journal entries older than 2 days do NOT surface in LLM context"

E2E_RUN_UUID="${E2E_RUN_UUID:-$(date -u +%s%N)}"
STALE_MARKER="STALE_${E2E_RUN_UUID}"
ANCIENT_MARKER="ANCIENT_${E2E_RUN_UUID}"

# Bash >= 4 / GNU date for portable backdated ISO timestamps.
_iso_days_ago() {
  date -u -d "$1 days ago" +%Y-%m-%dT%H:%M:%S.%3NZ
}

prepare() {
  kb work create stale-demo "Stale-filter demo"
  kb work start stale-demo

  # Setup writes entries directly so we can backdate them — kb work
  # journal would stamp today. We append in chronological order to
  # match appendJournal's ordering invariant.
  local jrnl="$SPIKE_INSTANCE/workspaces/stale-demo/journal.jsonl"
  local stale_date ancient_date
  stale_date="$(_iso_days_ago 5)"
  ancient_date="$(_iso_days_ago 10)"
  printf '{"date":"%s","id":"e2e-ancient","text":"Marker %s: paused work on the old payments module."}\n' \
    "$ancient_date" "$ANCIENT_MARKER" >> "$jrnl"
  printf '{"date":"%s","id":"e2e-stale","text":"Marker %s: did some experimentation with caching."}\n' \
    "$stale_date" "$STALE_MARKER" >> "$jrnl"

  # A handoff written today so the workspace context block has SOMETHING
  # to render — without any recent journal, the system prompt's
  # ## Recent Journal section is empty/absent and the LLM may fill the
  # void with hallucinated "you have nothing to do" answers that make
  # it hard to distinguish "filter worked" from "no workspace context."
  kb work handoff "Currently between projects; no active in-flight work."

  # Commit the direct-write so the scenario branch records what we did.
  ( cd "$SPIKE_INSTANCE" && git add -A && git commit -q -m "scenario setup: backdated journal entries" )
  kb save
}

stimulate() {
  step "ask-recent" --prompt "Quote my most recent journal entry verbatim, including any reference IDs. Reply 'no recent journal entries' if there are none."
}

observe() {
  # Stale entries must NOT leak into LLM context.
  assert_llm_not_contains "$STALE_MARKER"
  assert_llm_not_contains "$ANCIENT_MARKER"
  assert_step_status_is   "completed"
}
