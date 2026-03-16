# Workspaces Implementation Retrospective

Completed: 2026-03-16

## What worked

1. **Sequential phase execution.** W1 → W2 → W3 in strict order prevented the merge conflicts and branch collisions documented in the core mykb retrospective. Each phase built on a verified, merged foundation.

2. **Design guardrails as phase gates.** The 9 workspace-specific guardrails (no fs in consumers, no hardcoded paths, partial state updates, etc.) caught zero violations because agents followed them from the start. Embedding guardrails in agent prompts is more effective than checking after the fact.

3. **FileSystemWorkspaceStorage as single abstraction point.** All fs operations, path construction, and file format knowledge are in one class. CLI, extension hooks, and tools use only the WorkspaceStorage interface. This will make future storage backend swaps trivial.

4. **Existing test patterns.** The withTempBrain helper, createMockPi pattern, and CLI integration test pattern from the core build were reused directly. No test infrastructure work was needed for workspaces.

5. **Bottom-up ordering.** Types → Storage → Journal → Rendering → Documents → CLI → Extension. Each step had testable output. No integration surprises because lower layers were proven before upper layers were built.

6. **Agent prompts with precise context.** Giving each subagent the exact source code it needed to read (not just file paths, but what patterns to follow) reduced agent exploration time and produced code that matched existing conventions.

7. **LLM acceptance tests validated the full stack.** All 4 targeted tests and the 6-step e2e user journey test passed on first run, confirming that workspace context injection, tool usage, scorer boost, and cross-session persistence all work correctly.

## What didn't work

1. **Journal date format inconsistency.** The CLI `journal --show` displays ISO timestamps (2026-03-16T07:42:03.123Z) but the design doc showed date-only format (2026-03-16). Minor cosmetic issue, not a functional problem.

2. **Bundle rebuild as manual step.** After implementing W3, the esbuild bundle + container npm install had to be done manually before acceptance testing. This should be scripted.

## What could be improved

1. **Bundle rebuild script.** Add an npm script: `"bundle": "esbuild src/extension/index.ts --bundle --platform=node --format=esm --outfile=dist/bundle/index.js --external:better-sqlite3 --target=esnext --legal-comments=none"`. This was a recommendation from the core retrospective that was not implemented.

2. **Acceptance test automation.** The 4 acceptance tests and 6-step e2e journey should be scripted as a shell script (`scripts/acceptance-test.sh`) that sets up the brain, runs vfa commands, and checks output with grep. Currently manual.

3. **Date formatting in journal display.** Consider formatting journal dates as date-only (YYYY-MM-DD) in renderWorkspace and CLI output for readability, while keeping full ISO in the JSONL storage.

4. **Document index testing with real Pi.** The document index feature (scanDocumentIndex, updateDocumentIndex) was tested at the unit level but not via LLM acceptance tests. The AI creating a doc in the workspace directory and the index picking it up on save is the intended flow — worth testing when time allows.

## Metrics

| Metric | Value |
|--------|-------|
| Design documents | 3 (design, plan, guardrails) |
| Implementation phases | 3 (W1, W2, W3) |
| Subagent launches | 3 (one per phase) |
| New source files | 4 (workspace.ts, kb-work-state.ts, kb-work-journal.ts, work.test.ts) |
| Modified source files | 8 (types.ts, errors.ts, index.ts, render.ts, cli.ts, session.ts, scorer.ts, state.ts, tools/index.ts, extension/index.ts, context.ts) |
| New tests | 65 (35 W1 + 20 W2 + 10 W3) |
| Total tests | 299 |
| LLM acceptance tests | 4 targeted + 6-step e2e journey (10 total, all pass) |
| Commits | 20 |
| Bugs found during acceptance | 0 |
| Guardrail violations | 0 |
| Total LLM cost (acceptance tests) | ~$0.006 |

## Comparison with core mykb retrospective recommendations

| Recommendation | Followed? | Result |
|---------------|-----------|--------|
| No parallel implementation agents | Yes | Zero merge conflicts |
| Deploy spike alongside logic spikes | N/A | No new spikes needed |
| Bundle build as documented phase | Partially | Manual but documented |
| Phase gate scripts | No | Manual but fast |
| Known format documentation | N/A | Existing formats reused |
| Pi type stub validation | N/A | No new Pi types needed |
| LLM acceptance test automation | No | Manual but all pass |
| Research agent time budgets | N/A | No research agents used |

## Key decisions validated

1. **WorkspaceStorage interface abstraction** — CLI and extension don't know about the filesystem. Future backend swap requires only a new implementation class.
2. **Thin workspace metadata** — workspace.json is small (state + links + document index). Knowledge stays in mykb areas. No data duplication.
3. **Scorer boost for linked areas** — WORKSPACE_BOOST of 0.5 is enough to pre-seed Tier 2 injection without overwhelming the token budget.
4. **No auto-journal on shutdown** — The AI explicitly writes journal entries via kb_work_journal tool during the session. This avoids the OSB v1 problem of low-quality auto-generated summaries.
5. **Document index via frontmatter** — Cheap scanning (first 10 lines per file), no LLM needed for summarization, index regenerated on save.
