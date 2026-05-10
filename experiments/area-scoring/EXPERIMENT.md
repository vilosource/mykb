# Experiment: area-scoring

**Source spec:** `src/extension/scorer.ts` + `src/extension/hooks/context.ts` (no single design doc — the scorer is the most-touched module in mykb).
**Implementation:** `src/extension/scorer.ts` (`scoreAreas`, `selectEntriesForInjection`), `src/extension/hooks/context.ts` (per-turn scoring + injection), `src/extension/hooks/signals.ts` (signal capture from input/tools/file paths).

## Intent

Area scoring is the heart of mykb. On every turn, the `context` hook collects signals (user input, tool results, file paths from Read/Write/Edit) and scores all areas against them via word overlap on summary+tags. The top-scoring areas' entries are injected as a system message within a 2000-token budget. The Pi extension also exposes `kb_search` and area-loading tools the LLM can call directly.

A regression in either path silently degrades every Pi session. Unit tests cover the scorer's math; this experiment proves the LLM-facing chain (the LLM can find a fact added to a fresh area) actually runs end-to-end against a real Pi.

**Important caveat — v1 conflates scoring with tool access.** The current matrix proves the *user-visible* behavior ("the LLM uses an area's facts when asked about its topic"), but does NOT distinguish whether the area arrived in the LLM's context via the scorer's auto-injection or via a tool call (`kb_search`, `kb_load`, etc.) the LLM made on its own. Two real mykb issues surfaced while writing this experiment that explain the conflation:

1. **`kb init area` does not regenerate `manifest.json`.** Only `appendEntry`'s auto-create path calls `regenerateManifest`. Areas created via `kb init area` followed by `kb add fact` never reach the manifest, and the `context` hook reads the manifest. So the scorer never sees them.
2. **`ManifestArea` does not include `tags`.** Even when the manifest *is* refreshed, `context.ts:42-49` builds AreaMetadata with `tags: []`. So `--tags` provided to `kb add fact` are invisible to the scorer; only `summary` text drives keyword overlap.

A v2 of this experiment should either (a) wait for those issues to be fixed and add scoring-isolated scenarios, or (b) run scenarios with kb tools disabled in the vfa profile so only the scoring path can deliver a fact. v1 is intentionally coarse: the matrix detects "LLM cannot use an added area's facts at all" — which would be a worse regression than either bug alone.

This is the first experiment of what should grow into a fuller area-scoring matrix as we exercise more sub-behaviors (workspace boost vs keyword strength, sticky-area persistence across turns, token-budget eviction order, FilePathSignalProvider paths).

## Behavior matrix

| Stimulus | Expected behavior | Scenario | Status |
|----------|-------------------|----------|--------|
| Prompt's keywords match an area's summary/tags | LLM cites a fact from that area (proves: area loaded → entries reached the system prompt → LLM used them) | `keyword-match-loads` | ✅ |
| Prompt is about an unrelated topic; the area exists but its keywords don't match | LLM answer does NOT contain the area's marker fact | `off-topic-no-leak` | ✅ |
| No active workspace; area exists with matching keywords | Area still loads via keyword scoring (linking is a boost, not a gate) | `no-workspace-still-loads` | ✅ |
| Area created via `kb init area --tags`; manifest has tags | Manifest regenerates; scorer sees tags | `init-area-tags` | ✅ |
| `kb_list` output includes the `[tags: ...]` suffix | LLM disambiguates by tag | `kb-list-shows-tags` | ✅ |
| With `MYKB_DISABLE_TOOLS=1`, the system-prompt area-index reaches the LLM | LLM cites area-id from `<mykb-areas>` despite no tools | `scoring-without-tools` | ✅ |
| Multi-step + persisted signals: per-turn `<mykb-context>` delivers entry-level marker fact with all tool fallbacks forbidden | LLM cites the marker; injection delivered via cycle-8 file-backed `SessionState` | `scoring-isolated` | ✅ |
| Two areas score equally on keyword overlap; only one is linked to the active workspace | The linked area wins via workspace-boost; LLM cites that area's fact | `workspace-boost` | 🚧 not yet implemented |
| An area loaded in turn N gets a sticky-boost in turn N+1; equally-scoring competitor doesn't | LLM cites the sticky area's fact in turn N+1 over a freshly-matched competitor | `sticky-area-persistence` | 🚧 not yet implemented |
| Many areas score; total entries exceed the 2000-token budget | Highest-scoring areas keep their entries; lower-scoring areas drop entries first; widget marker stays in (because widget area scored highest) | `token-budget-eviction` | 🚧 not yet implemented |
| LLM uses Read on a file whose path tokens overlap an area's tags | `FilePathSignalProvider` emits a signal; that area scores; subsequent turn injects | `file-path-signal` | 🚧 not yet implemented |

The first 7 rows are **implemented and RED-proven** — see [`scenarios/`](scenarios/). The last 4 rows are tracked in [`docs/experiment-coverage.md`](../../docs/experiment-coverage.md) as scaffolded sub-behaviors. Each becomes a `scenarios/<name>.sh` when implemented.

### Sub-behavior implementation notes (for the 4 scaffolded rows)

- **`workspace-boost`**: prepare two synthetic areas with identical keyword-overlap-to-prompt; link one to the active workspace via `kb work create --areas`. The boosted area should win injection. Marker pinned to the boosted area's fact only.
- **`sticky-area-persistence`**: two-step. Step 1 establishes signals matching area X (loads it → marked sticky). Step 2 asks a prompt that scores X and a fresh competitor Y equally on keywords; assert X wins because of sticky boost. Uses cycle-8 file-backed SessionState (automatic).
- **`token-budget-eviction`**: prepare 5+ synthetic areas with distinct keyword-overlap signals; the marker fact lives only in the highest-scoring area. Total entry text exceeds 2000 tokens. Assert the marker reaches the LLM (top area kept) AND a low-scoring area's marker does NOT (evicted).
- **`file-path-signal`**: prepare an area whose tags match a path component (e.g. tags=`["frobnicator"]`, file path `/tmp/frobnicator/spec.md`). Step 1 has the LLM Read that file (legit Pi runtime tool fires). Step 2 asks a domain question; the file-path signal should have scored the area; assert injection.

## Notes

- **Setup creates a synthetic area `e2e-widgets-<run-uuid>`** with a single marker fact. Using a synthetic area makes the assertion deterministic — there's no risk that some other real area in `~/.mykb` happens to mention "widgets" and steals the score.
- **Marker discipline:** the fact's text contains a unique `WIDGET_MARKER_<run-uuid>` so the assertion proves the area's actual *content* reached the LLM (not just that the LLM heard the topic from the prompt).
- **Keyword choice:** the area's summary uses words that overlap unmistakably with the prompt for `keyword-match-loads` (intentional positive control), and conspicuously do NOT overlap with the prompt for `off-topic-no-leak` (intentional negative control). The negative prompt asks something purely arithmetic so the LLM has no reason to pull in widget content.
- **`assert_step_status_is "completed"`** is mandatory — without it, a vfa runaway-streaming failure on the negative prompt would falsely satisfy the marker-absence assertion.
- The marker is also placed in the area's summary so word-overlap will pick the area. Putting it only in the fact text wouldn't help: scoring is on summary/tags, not entries.
