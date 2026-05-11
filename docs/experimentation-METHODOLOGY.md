# Experimentation Methodology

> **Status:** mandatory — every Layer-4 feature implementation follows this.
>
> **Audience:** anyone (operator or LLM) implementing a feature in mykb whose behavior emerges only when Pi runs against a real brain.
>
> **Companion docs:** `development-MANIFESTO.md` (testing pyramid), `experiments/README.md` (folder layout), `scripts/spike/README.md` (operator commands once the harness exists).

## Why this exists

Unit tests prove "the function returns the right value." CLI integration tests prove "the command produces the right output." Neither proves what mykb actually has to deliver: **the LLM, sitting in a real Pi session, with a real workspace, with real journal/handoff/area state, behaves correctly when the feature fires.**

That's what this methodology gives us. It is not a test framework — it is a small experimentation platform where we treat the kb as a brain and ourselves as neuroscientists. We clone the brain, attach an isolated Pi to the clone, apply controlled stimuli, and observe.

The same machinery serves three intents:

| Intent | Example |
|--------|---------|
| **Spike** — ad-hoc one-off question | "What does the LLM do if I corrupt handoff.json?" |
| **Scenario** — versioned regression test | "Resume continuity passes against a fresh brain" |
| **Comparison / A-B** — same input, two builds | "Same prompt against develop bundle vs. feature/X bundle" |

A successful spike graduates into a scenario. Scenarios accumulate as the regression suite. There is no separate "test framework" — the experimentation primitive is the only primitive.

## The neuro lab model

Three nouns. Memorize them.

**Specimen.** Your live brain at `~/.mykb`. Sacred. Never touched directly by the harness. The harness's only operation against the specimen is `git clone ~/.mykb <instance>` — non-destructive even on a busy git repo. If the harness is about to mount `~/.mykb` into a container or run a kb command against `MYKB_DIR=$HOME/.mykb`, that's a bug — refuse.

**Brain instance.** A clone of the specimen at `~/.mykb-experiments/<exp-id>/`. Mutable, disposable, audit-trailed via git. Every step in an experiment commits to the instance's git history. The instance directory IS the experiment record — git history, captured prompts/responses, kb state, metadata, all in one place.

**Pi instance.** A Pi runtime container attached to exactly one brain instance. Has its own session id, ephemeral filesystem, isolated mounts. Cannot see the host's Pi or the specimen. Each `step` in an experiment is one fresh Pi container.

## Architecture

```
~/.mykb (specimen, sacred)
   └─► git clone (per experiment)
        ▼
~/.mykb-experiments/<exp-id>/   (brain instance)
   ├── .git/                    full git history; per-step commits
   ├── .e2e-build/              snapshot of dist/ (build of record)
   ├── .e2e-meta.json           experiment id, source commit, build sha, intent
   ├── areas/                   ← clone of specimen's areas
   ├── workspaces/              ← clone of specimen's workspaces
   └── ... (rest of brain)
        ▲
        │ mounted at /home/node/.mykb
        │
~/.vf-agents/profiles/e2e-<exp-id>.yaml   (per-experiment Pi profile)
        │
        ▼
   vfa run --provider pi --profile e2e-<exp-id> --prompt "..."
        ▼
   Pi container (isolated)
   ├── KB_SESSION_ID = <exp-id>-<step-n>
   ├── /home/node/.mykb     ← brain instance (writable)
   ├── /home/node/.pi/agent ← host's Pi config (read-only)
   └── /home/node/.pi/agent/extensions/mykb ← .e2e-build/bundle/ (the artifact under test)
```

## The kb-spike harness

A small bash CLI at `scripts/spike/kb-spike` with a tight verb set:

```
kb-spike new       [--experiment <name>] [--intent "..."] [--from-branch <ref>] [--bundle <path>]
kb-spike run       <exp-id> --prompt "..."
kb-spike run-scenario <exp-id> <scenario-name>
kb-spike show      <exp-id>
kb-spike diff      <exp-id> [scenario]
kb-spike list
kb-spike discard   <exp-id>
kb-spike archive   <exp-id>
kb-spike promote   <exp-id> --as <scenario-name>   # spike → scenario
```

### The boundary rule

**The harness control plane never calls `kb` directly.** Only scenario scripts do, and they invoke `$INSTANCE/.e2e-build/cli.js` — the per-experiment captured build, never the host's `kb`.

Why this matters: we are testing kb. If `kb-spike` were itself a `kb` subcommand or shelled out to the host's `kb`, then a broken kb on the working tree would break the harness, defeating the point of running the harness in the first place. With the boundary rule:

- A broken kb on the working tree → scenarios fail. Correct: the regression we wanted to catch.
- The harness control plane runs even if kb is broken. The failure is reported. The scenario branch is preserved for inspection.

The control plane shells out only to: `git`, `docker`, `vfa`, `jq`, `cp`, `rm`. None of those are under development here.

### Build is captured per experiment

At experiment creation, the harness snapshots `dist/bundle/index.js` (Pi extension) and `dist/cli/cli.js` (CLI) into `<instance>/.e2e-build/`. The vfa profile mounts from there, not from the live `dist/`. This eliminates the race between an experiment running and a parallel `git checkout` (or another agent) changing the working tree.

The instance metadata records: source commit (which `~/.mykb` HEAD), build commit (which mykb commit produced the bundle), dirty flags. Reproducibility on a new machine = `git checkout <build-commit>` + `npm run build && npm run bundle` + re-run scenarios against a fresh clone.

### Concurrency

Experiments are independent and can run in parallel:

- Each has its own `~/.mykb-experiments/<id>/` (no shared brain state)
- Each has its own vfa profile YAML (named with the experiment id)
- Each has its own KB_SESSION_ID (set per-experiment, not inherited from the host shell)
- Container names are unique (vfa already does this)
- Build snapshot is per-experiment (no race with `git checkout`)

The only shared resource is the host's Docker daemon — fine, it's designed for concurrency.

## Spec-driven experiments

Each feature gets a folder under `experiments/<feature>/` in the mykb repo. The spec is in-repo, version-controlled with the implementation, reviewed alongside feature changes.

```
experiments/<feature>/
├── EXPERIMENT.md           ← the spec (intent, behavior matrix, scenarios index)
├── scenarios/              ← executable scenario scripts
│   ├── <scenario-1>.sh
│   ├── <scenario-2>.sh
│   └── ...
└── runs/                   ← gitignored — local run history
    └── <run-id>/
        └── result.json
```

### EXPERIMENT.md contract

```markdown
# Experiment: <feature-name>

**Source spec:** docs/<feature>-DESIGN.md (or pointer to whatever doc defines the feature)
**Implementation:** src/<file>:<line> (the code being exercised)

## Intent

One paragraph. What does this feature do? What workflow problem does it solve?
Why does it need Layer-4 validation (i.e., why aren't unit tests sufficient)?

## Behavior matrix

| Stimulus                                      | Expected behavior          | Scenario   |
|-----------------------------------------------|----------------------------|------------|
| <condition the feature is meant to handle>    | <what should happen>       | <name>     |
| <a condition that should NOT trigger it>      | <feature stays silent>     | <name>     |
| <boundary case>                               | <behavior per policy>      | <name>     |

The matrix is the spec. Each row is a scenario. Adding a row = adding a scenario script.

## Notes

Anything an implementer needs to know to interpret the matrix or write
new scenarios.
```

### Behavior matrix discipline

For any **behavior-counting feature** (hooks, signal capture, side-effect counters, context filters), the matrix must include both:

- **Positive scenarios** — the feature fires when it should
- **Negative scenarios** — the feature does NOT fire when it shouldn't

A "passes when stimulated" test alone doesn't distinguish a working feature from a broken feature that fires constantly. The pair does.

For boundary cases (false-positive risk, edge inputs), add scenarios as the implementation surfaces real edge cases. Don't try to enumerate them upfront.

## Scenario shape

Each scenario is a small bash file. The harness sources it and provides functions: `intent`, `prepare`, `stimulate`, `observe`, `step`, `assert_*`.

```bash
# experiments/<feature>/scenarios/<scenario-name>.sh

intent "One sentence. What this scenario probes."

prepare() {
  # Put the brain instance in the state we want to observe under.
  # Each kb command commits as a step. Use the experiment's captured kb,
  # not the host's: handled by the harness via $INSTANCE_KB.
  kb work create test-ws "Test"
  kb work start test-ws
  # ... whatever lineage the feature needs ...
  kb save
}

stimulate() {
  # The controlled inputs we're studying.
  step "first probe" \
    --prompt "..."
  step "second probe" \
    --prompt "..."
}

observe() {
  # Read whatever the feature affects.
  assert_llm_contains "..."
  assert_state_file_field "<path>" "<jq-query>" "<expected>"
  assert_counter "<name>" <expected>
}
```

### Why prepare / stimulate / observe instead of setup / run / assert

The brain-surgery framing. We're not running tests in the QA sense. We are observing the brain under controlled conditions:

- **Prepare** — establish the world state that would naturally produce the conditions the feature handles
- **Stimulate** — apply the controlled input we are studying
- **Observe** — read whatever surface the feature affects

The phases blur for some features. Setting up a brain to test a hook that counts every Pi invocation means setup itself includes Pi invocations. That's fine — the harness primitives work in any phase.

### Setup is on a spectrum

Setup weight depends on the feature class:

| Class | Setup pattern | Example |
|-------|---------------|---------|
| **Knowledge-graph features** | None or minimal — clone the brain, use real workspaces | scorer changes, retrieval, bi-temporal validity |
| **Workflow-state features** | Light — clone + create workspace, inject markers, set active | journal-auto-inject, no-active-workspace neutrality |
| **Hook / counter features** | Heavy — simulate the stimulus the hook is supposed to react to (often via `step` calls inside `prepare`) | secrets-counter, signal capture |
| **CLI mechanics** | Minimal or fixture | `kb add`, `kb update` |

The methodology rule that catches most setup mistakes: **every line in `prepare()` should plausibly be something a real session would do**. If you're injecting state directly that no realistic workflow would produce, the test isn't testing the workflow — it's testing the bypass.

### Markers must be unique per scenario per run

Setup injects unique markers (`E2E_<scenario>_<run-uuid>`) the LLM is expected to surface. The harness generates the UUID at run start and exposes it as `$E2E_RUN_UUID`. This ensures a stale fixture from a previous run can't accidentally satisfy this run's assertion.

## Assertion vocabulary

```bash
# Output assertions — what the LLM said
assert_llm_contains "..."             # marker present in last step's output
assert_llm_not_contains "..."         # marker absent
assert_llm_contains_any A B C         # at least one
assert_llm_contains_all A B C         # all
assert_step_status_is "<step>" "<status>"   # e.g. "completed"

# State assertions — what changed on disk in the brain instance
assert_branch_diff_empty                            # no mutations at all (rarely usable —
                                                    #   the harness commits .e2e-steps/ and the
                                                    #   cleared workspaces/.active onto every branch)
assert_branch_diff_contains "<path>"                # specific file mutated
assert_branch_diff_not_contains "<path>"            # specific file untouched
assert_no_branch_diff_match "<regex>"               # nothing of this shape mutated (the working
                                                    #   negative companion to ...diff_contains)
assert_state_file_field "<path>" "<jq-query>" "..."  # JSON field equality
assert_jsonl_count "<path>" <n>                     # line count
assert_jsonl_contains "<path>" "<substr>"           # some line contains substr

# Counter / event assertions — for hook-counting features
assert_counter "<name>" <expected>
assert_event_log_has "<event-type>" <expected-count>

# Build / metadata assertions — rare, but useful for sanity
assert_source_commit "<sha>"          # we cloned from the right place
assert_build_commit "<sha>"           # we tested the right build
```

Pass requires all assertions in `observe()` to succeed. On any failure, the scenario branch is preserved (not auto-discarded) so the operator can inspect.

## Lifecycle

### Spawn

```bash
exp=$(kb-spike new --experiment <feature> --intent "...")
```

What happens:
1. Read `experiments/<feature>/EXPERIMENT.md` (validate the experiment exists).
2. `git clone ~/.mykb ~/.mykb-experiments/<feature>-<run-ts>/`
3. In the clone: `git tag e2e/source && kb rebuild` (the captured kb regenerates the SQLite mirror from JSONL).
4. Snapshot `dist/bundle/index.js` and `dist/cli/cli.js` into `<instance>/.e2e-build/`. Record the git ref of the snapshot.
5. Generate `~/.vf-agents/profiles/e2e-<feature>-<run-ts>.yaml` with mounts pointing at this instance.
6. Write `<instance>/.e2e-meta.json` with experiment metadata.
7. Return the run id.

### Talk

```bash
kb-spike run-scenario "$exp" <scenario-name>
# or ad-hoc:
kb-spike run "$exp" --prompt "what if I ask this?"
```

Per scenario:
1. Branch off `e2e/source` → `e2e/<scenario>`.
2. Source the scenario script. Run `prepare()` — each kb command commits.
3. Run `stimulate()` — each `step` invokes vfa, captures the JSON, commits.
4. Run `observe()` — assertions; failures are recorded but don't abort. All assertions in `observe` run.
5. Tag end of scenario: `e2e/<scenario>-end`.
6. Write a one-line scenario result to `runs/<run-id>/result.json`.

### Examine

```bash
kb-spike show "$exp"
# Prints: experiment id, source commit, build commit, scenarios run, pass/fail per scenario, paths

kb-spike diff "$exp" <scenario>
# git diff e2e/source..e2e/<scenario>-end inside the instance
```

If a scenario failed: the scenario branch is intact. `cd ~/.mykb-experiments/<exp-id>/` and use any git tools — `git log e2e/<scenario>` shows step commits with prompts/responses, `git diff` shows mutations between any two steps.

### Discard

```bash
kb-spike discard "$exp"
```

What happens:
1. Write `experiments/<feature>/runs/<run-id>/result.json` (pass counts, fail counts, source/build commits, timing).
2. If `--keep-history`: `git bundle create runs/<run-id>/scenarios/*.bundle` for replay.
3. `rm -rf ~/.mykb-experiments/<exp-id>/`.
4. Remove the vfa profile YAML.

What survives: the spec (in mykb's git history), and the slim run record at `experiments/<feature>/runs/`. What dies: the brain clone, the build snapshot, the vfa profile.

`kb-spike archive` is a softer version: moves the instance to `~/.mykb-experiments/archive/` instead of deleting. Use when you want to keep an instance for later reference but free it from the active list.

## Promotion path: spike → scenario

A successful spike (ad-hoc `kb-spike run "$exp" --prompt "..."`) is interactive exploration. A scenario is a versioned, regression-safe assertion. Path from one to the other:

```bash
kb-spike promote "$exp" --as <scenario-name>
```

Reads the scenario branch's commits, regenerates them as a setup script + step calls, drops the scaffold into `experiments/<feature>/scenarios/<scenario-name>.sh`. The operator fills in the `intent` and `observe` assertions, commits.

This makes spikes graduate cleanly into regressions without rewriting from scratch. Encourages spiking — the work isn't wasted; it becomes a test.

## Integration with the manifesto

`docs/development-MANIFESTO.md` already defines four testing layers. kb-spike experiments **are** Layer 4 (Behavioral Validation), not a new layer. The manifesto's Layer 4 description is updated to include this methodology.

The Change-Type → Test Requirements table includes a row for hook behavior (Layer 1 + Layer 4 required). The Feature Completion Checklist includes a line: "If the feature touches Layer-4 behavior — kb-spike experiment for the feature passes end-to-end."

When experiments run:

- **Inner loop (every commit):** Layers 1–2 stay fast (`npm test`).
- **Pre-merge / pre-tag (Feature Completion):** Layer-4 experiments must pass.
- **Manual / on suspicion:** any time, operator-invoked.

Layer 4 is gated at feature-done time, not every commit. It's expensive (LLM calls, container starts) and the value is in catching workflow-level regressions, not inner-loop tightening.

## Worked examples

### Example 1: handoff feature

```
experiments/handoff/
├── EXPERIMENT.md
└── scenarios/
    ├── continuity.sh           # fresh session resumes from prior session's handoff
    ├── overwrite.sh            # second handoff replaces first
    ├── clear.sh                # --clear removes it
    └── stale-detection.sh      # newer-journal flag fires
```

Behavior matrix:

| Stimulus | Expected | Scenario |
|----------|----------|----------|
| Workspace has prior handoff text | LLM cites handoff in fresh session | continuity |
| Two handoffs written in sequence | Second overwrites first; LLM sees only second | overwrite |
| `kb work handoff --clear` | LLM no longer sees old handoff | clear |
| Journal entry newer than handoff | LLM sees "may be outdated" mark | stale-detection |

`prepare()` for `continuity.sh` simulates plausible workflow lineage: creates workspace, sets state, writes journal entries representing prior milestones, adds a fact, then writes the handoff that summarizes where things stand. The handoff has content because there's work for it to summarize.

### Example 2: hypothetical secrets-counter (Layer-4 hook feature)

A hook scans outgoing context for secret patterns, increments a counter.

Behavior matrix:

| Stimulus | Expected | Scenario |
|----------|----------|----------|
| Prompt retrieves a fact w/ secret-pattern content | Counter +1 | positive |
| Prompt retrieves only non-secret facts | Counter unchanged | negative |
| Fact contains secret-shaped string that is NOT a secret (UUID, hash) | Per policy (likely no increment) | boundary |
| Counter file missing at start | Created at value 0 | bootstrap |

Setup for `positive.sh` is **heavy**: creates a workspace, adds facts containing real-looking secrets, runs prompts that retrieve them. Setup for `negative.sh` mirrors the structure with non-secret content. Pair is mandatory — without `negative.sh` you can't tell a working hook from a hook that fires every turn.

### Example 3: journal-auto-inject (the feature that prompted this methodology)

```
experiments/journal-auto-inject/
├── EXPERIMENT.md
└── scenarios/
    ├── resume-continuity.sh    # fresh session sees yesterday's marker
    ├── stale-filter.sh         # >2-day entries don't surface
    ├── mid-session-append.sh   # turn 1 appends, turn 2 sees it
    └── no-active-workspace.sh  # no journal block leaks when no workspace active
```

The cap-saturation case (>20 entries) is covered by the unit test for the helper (`tests/core/journal-window.test.ts`) — no Layer-4 scenario needed for it.

## What this methodology rules out

To make the rules concrete, here's what the methodology forbids:

- **Mutating `~/.mykb` directly during a test.** The harness must refuse a profile or kb invocation that mounts/targets `$HOME/.mykb`.
- **Running the harness against a live working-tree build.** Always snapshot to `<instance>/.e2e-build/` first. If you don't snapshot, a `git checkout` mid-run produces nondeterministic results.
- **Calling `kb` directly from the harness control plane.** Only scenarios call kb, and they call the captured build. Lint catches violations.
- **Adding a positive scenario without a paired negative scenario for behavior-counting features.** Hooks, counters, signal-capture features without a "doesn't fire when it shouldn't" scenario will silently regress to constant-firing.
- **Synthetic setup that doesn't represent plausible workflow lineage.** If `prepare()` injects state no real session would produce, the test is testing the bypass, not the workflow.
- **Auto-discarding instances on failure.** Failed scenarios preserve the branch; operator inspects with normal git tools.

## Maintenance discipline

- **Every Layer-4 feature** has an `experiments/<feature>/EXPERIMENT.md` and at least one scenario.
- **Adding a scenario** to an existing experiment is a normal commit on whatever feature branch the work happens on. Scenarios are diff-reviewable like any code.
- **Removing a scenario** requires the same justification as removing a unit test: the scenario must be obsolete (feature removed, behavior intentionally changed, etc.). Document the reason in the commit.
- **Run results** under `experiments/<feature>/runs/` are gitignored. They are local, ephemeral, and accumulate fast — operator prunes periodically. The durable artifacts are the spec and the scenarios.
- **Bumping the methodology** itself: edit this doc, update the manifesto's Layer 4 description in lockstep, commit together.

## Quick reference

| Verb | What it does |
|------|--------------|
| `kb-spike new` | Clone brain, snapshot build, generate Pi profile, return exp-id |
| `kb-spike run-scenario` | Run one scenario; commit each step; assert |
| `kb-spike run` | Ad-hoc one-prompt step (for spiking) |
| `kb-spike show` | Metadata + scenario pass/fail summary |
| `kb-spike diff` | Mutations from `e2e/source` |
| `kb-spike list` | All active experiments |
| `kb-spike discard` | rm instance, save run record |
| `kb-spike archive` | Move instance to archive/, save run record |
| `kb-spike promote` | Spike → scenario script in experiments/<feature>/scenarios/ |
