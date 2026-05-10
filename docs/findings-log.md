# Findings log

> **Purpose:** central index of every latent production bug AND every methodology gotcha discovered while building the Layer-4 experiment matrix. Each finding has a permanent record in three places — this log (forward-facing index), a kb gotcha on the `mykb` area (queryable by keyword), and the commit message of the cycle that surfaced/fixed it (git-archeology). This doc is the index you read FIRST when assessing the state of mykb's correctness.
>
> **Maintenance:** new finding → add row here + file kb gotcha + reference the gotcha id from the cycle commit. Status transitions (📋 documented → 🐛 known-fail with regression scenario → ✅ fixed) update inline.

## Latent production bugs

Each row was either fixed during the same cycle that surfaced it, or is currently a documented known-gap with a regression-home scenario.

| ID (kb gotcha) | Component | Description | Surfaced by | Status |
|---|---|---|---|---|
| `CdWh6imY` | `cli.ts` | `kb init area` did not regenerate `manifest.json`. Areas created via CLI + `kb add fact` were invisible to the scorer. | `experiments/area-scoring/scenarios/init-area-tags.sh` (Cycle 1) | ✅ Fixed (commit `39e2895`) |
| `0cmiPagq` | `manifest.ts` + `context.ts` | `ManifestArea` schema lacked `tags`; `context.ts` hard-coded `tags: []` when building `AreaMetadata`. Tag-based scoring never worked. | Same cycle as above | ✅ Fixed (commit `39e2895`) |
| — (no gotcha id; see Cycle 5 commit) | `src/core/db.ts` | `entries_fts` indexed entry text/tags + area-id only — not area summary or area-level tags. A query whose keyword appeared only in area metadata returned zero results. | `experiments/kb-search/scenarios/tool-finds-via-area-metadata.sh` | ✅ Fixed (commit `0246a0b`) — added `areas_fts` virtual table |
| — (no gotcha id; see Cycle 9 commit) | `src/core/workspace.ts` (`addArtifact`) | `wsa add` had a TOCTOU race. Two concurrent `kb wsa add <same-filename>` calls both succeeded and left 2 metadata entries. | `tests/cli/artifact-isolation.test.ts` (L1, but the test was flaky pre-fix) | ✅ Fixed (commit `33142fc`) — per-filename claim file |
| `TPafXsZF` | `src/extension/hooks/context.ts` | Three-layer latent bug stack in the per-turn `<mykb-context>` injection: (1) handler read `args[0] as Message[]` instead of `event.messages` from the ContextEvent; (2) handler returned bare `Message[]` instead of `{messages: ...}` ContextEventResult; (3) `convertToLlm` in `pi-agent-core` silently filters `role: 'system'` messages — must use `role: 'custom'`. **Per-turn injection had been silently broken since the feature shipped.** Masked because every prior scenario asserting on entry text also had a `kb_load`/`kb_search` fallback. | `experiments/area-scoring/scenarios/scoring-isolated.sh` (Cycle 8) | ✅ Fixed (commit `08f732d`) |
| `K1yQnjNV` | `src/extension/hooks/tool-gating.ts` | **Security gap.** The hook only intercepts `write`/`edit` tool names. An LLM that reads the block's reason text routes around via `bash 'echo ... > file.jsonl'` — IO redirection bypasses gating entirely. Empirically observed. | `experiments/tool-gating/scenarios/bash-bypass-known-gap.sh` (Cycle 12) | 🐛 **Known-fail with regression home.** Fix paths documented in `experiments/tool-gating/EXPERIMENT.md`. |
| `BEbnk3iB` | `src/extension/hooks/signals.ts` | Two latent bugs: handler reads `event.tool` (Pi emits `event.toolName`) AND uses `'Read'`/`'Write'`/`'Edit'` (Pi registers lowercase `'read'`/`'write'`/`'edit'`). FilePathSignalProvider has never fired. | Discovered while reviewing `tool-gating` code paths (Cycle 12); no scenario yet | 📋 Documented; not yet fixed. Blocks `experiments/area-scoring/scenarios/file-path-signal.sh` from implementation. Two-line fix. |

## Methodology gotchas

Each row distills a Layer-4 testing discipline lesson — applicable to any future scenario in any matrix.

| ID (kb gotcha) | Lesson | Surfaced by |
|---|---|---|
| `WmFjQOKa` | **Tool-call scenarios must forbid fallback tools in BOTH the prompt AND the `observe()` assertions.** An LLM whose primary tool fails will route around (kb_load → kb_search → bash) and produce a false-pass on the primary's regression test. Discipline: `step --prompt "...Use ONLY <X>. Do not use <Y>, <Z>..."` paired with `assert_no_tool_calls <fallback-prefix>`. | `experiments/kb-search/scenarios/tool-finds-via-area-metadata.sh` (Cycle 5) |
| `FYSqWj10` | **Path-isolation: scenarios claiming to isolate one injection path must RED-prove that no parallel path serves the same info.** The `<mykb-workspace>` block lists linked area-ids — a scenario testing `<mykb-areas>` discovery that also creates a workspace silently leaks the answer through the workspace block. Generalization of WmFjQOKa from tool-paths to context-injection-paths. | `experiments/kb-load/scenarios/discover-via-area-index.sh` (Cycle 6) |
| `xa3WWwaT` | **Pi tool names with underscores can be misread by the LLM as snake-case shell commands.** The LLM saw `kb_list` and ran `bash 'kb list'` instead of invoking the registered Pi tool. Prompts must disambiguate explicitly: "registered Pi tool, NOT a shell command. Do not run bash." | `experiments/kb-list/scenarios/basic-list.sh` (Cycle 7) |
| `TPafXsZF` | **Pi's `context` event has 3 subtle contract requirements** that all must be right or injection is silently discarded: (1) read `event.messages`; (2) return `{messages: ...}`; (3) use `role: 'custom'` not `'system'`. Discipline: scenarios probing per-turn injection MUST forbid all tool fallbacks AND assert on a marker that's ONLY in entry text. (Also a production bug — see above.) | Same scenario; both bug + lesson | 
| `K1yQnjNV` | **Gating hooks that only intercept named tools are bypass-vulnerable when alternative tools exist** (bash, in this case). When designing a safety hook, enumerate the syscall-level mechanisms the LLM can reach, not just the tool-registration names. | Same scenario; both bug + lesson |

## Methodology gotchas predating this branch (kept for completeness)

These were filed before this branch's session — they shape current scenarios but were discovered earlier.

| ID | Lesson |
|---|---|
| `MLcIWnmY` | Claude Code `-p` (headless) mode does NOT inject `SessionStart` hook's `additionalContext` field into the LLM context. Use `--append-system-prompt-file` instead. |
| `DGhjwed1` | `claude -p` does not load project-level `.claude/settings.json` by default. Pass `--setting-sources user,project,local` explicitly. |
| `e5hOjC8D` | `vfa`'s claude adapter hardcoded `/workdir` as the mount point — profiles with `mount_path: /workspace` had cwd-vs-mount divergence and project settings weren't found. (Fixed locally; upstreamed via [vf-agents PR #10](https://github.com/vilosource/vf-agents/pull/10) as configurable env vars.) |

## Cross-references

- All gotchas above are also filed as `kb add gotcha mykb` entries — query via `kb load mykb` or `kb search <keyword>`.
- The [experiment-coverage doc](experiment-coverage.md) lists matrices; this doc lists findings discovered while building those matrices.
- Each ✅ Fixed row maps to a commit whose message contains the same `gotcha:<id>` cross-reference.
- Each 🐛 Known-fail row maps to a scenario file with the expected-fail behavior — flipping to ✅ requires both the production fix AND the scenario assertion staying intact.

## Why this log exists

Cycle 8 was the load-bearing demonstration: a 3-bug stack lay latent for the entire history of mykb's per-turn injection, masked because every prior scenario had a fallback path. We only found it because a scenario was deliberately designed to forbid every fallback. The cost of those bugs going unnoticed was zero until they weren't.

Tracking findings cheaply prevents the "feature X works because we never tested its failure mode" surprise. Read this doc whenever assessing what "everything works" actually means for mykb.
