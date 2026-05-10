# scripts/spike/ — kb-spike harness

Operator tool for running Layer-4 mykb experiments.
**Methodology:** [`docs/experimentation-METHODOLOGY.md`](../../docs/experimentation-METHODOLOGY.md) — read this before adding experiments.

## Verbs

```
kb-spike new --experiment <name> [--intent "..."]    # create instance
kb-spike run-scenario <exp_id> <scenario>            # run one scripted scenario
kb-spike run <exp_id> --prompt "..."                 # ad-hoc one-prompt spike
kb-spike show <exp_id>                               # metadata + results
kb-spike diff <exp_id> [scenario]                    # git diff e2e/source..HEAD
kb-spike list                                        # all active experiments
kb-spike archive <exp_id>                            # move instance to archive/ + drop profile
kb-spike discard <exp_id>                            # rm instance + profile
kb-spike promote <exp_id> --as <name> [--from <branch>]   # spike → scenario scaffold
```

### Spike → scenario lifecycle

`run` is the exploration primitive: ad-hoc prompts against an existing
instance, captured to `<instance>/.e2e-steps/_adhoc/NNN-spike.json` on
the `e2e/_adhoc` branch. Successive `run` calls accumulate (step
counter advances across invocations).

`promote` graduates a successful spike into a versioned scenario:
reads the captured step JSONs, emits a scaffold under
`experiments/<feature>/scenarios/<name>.sh` with `intent` /
`prepare` / `stimulate` / `observe` blocks. The operator fills in
`prepare()` (any `kb` setup needed) and `observe()` (the
assertions). `stimulate()` is pre-populated with `step` calls
matching the spike's prompts.

Use `--from <scenario>` to promote a passing scripted scenario into
a sibling variant (saves rewriting the prompts).

## Quick start

```bash
# Build kb so a snapshot exists.
cd ~/GitHub/mykb
npm run build && npm run bundle

# Spin up an instance for an existing experiment.
exp_id=$(scripts/spike/kb-spike new --experiment journal-auto-inject --intent "first run")

# Run a scenario.
scripts/spike/kb-spike run-scenario "$exp_id" resume-continuity

# Inspect.
scripts/spike/kb-spike show "$exp_id"
scripts/spike/kb-spike diff "$exp_id" resume-continuity

# Tear down.
scripts/spike/kb-spike discard "$exp_id"
```

## Environment

| Var | Default | Purpose |
|-----|---------|---------|
| `SPIKE_INSTANCES_DIR` | `$HOME/.mykb-experiments` | Where brain clones live |
| `SPIKE_SPECIMEN`      | `$HOME/.mykb`             | What we clone from (sacred) |
| `SPIKE_REPO_ROOT`     | derived from script dir   | mykb checkout root |
| `VFA_HOME`            | `$HOME/.vf-agents`        | vfa profile dir |
| `SPIKE_VFA_TIMEOUT`   | `120`                     | per-step timeout (seconds) |

## Layout

```
scripts/spike/
├── kb-spike            # entry point + verb dispatch
├── lib/
│   ├── clone.sh        # clone specimen, tag e2e/source
│   ├── build-snapshot.sh   # capture dist/{bundle,cli} into <instance>/.e2e-build
│   ├── profile.sh      # generate per-experiment vfa profile YAML
│   ├── meta.sh         # read/write <instance>/.e2e-meta.json
│   ├── step.sh         # scenario-facing step / kb / intent helpers
│   ├── assert.sh       # assertion vocabulary for observe()
│   └── scenario.sh     # spike_run_scenario lifecycle
└── README.md           # this file
```

Each lib is sourced into the kb-spike process. step.sh and assert.sh are also sourced into the scenario environment by scenario.sh, so scenarios get the helpers as plain bash functions.

## Boundary rule

The harness **control plane never calls the host's `kb`**. Only scenarios call kb, and they do so via the `kb()` function defined in `step.sh`, which routes to the per-experiment captured CLI at `<instance>/.e2e-build/cli/cli.js`.

Why: the harness has to keep working when kb is broken on the working tree. If `kb-spike` shelled out to the host's `kb`, a broken kb would break the harness — defeating the point. With the captured CLI:

- A broken host kb → scenarios fail. **Correct.**
- The harness control plane runs even when host kb is broken — operator can inspect the failure with normal git tools.

The lint at `tests/spike/boundary.bats` enforces this.

## What lives where

| Artifact | Path | Tracked in git? |
|----------|------|-----------------|
| Spec | `experiments/<feature>/EXPERIMENT.md` | yes |
| Scenarios | `experiments/<feature>/scenarios/*.sh` | yes |
| Run records | `experiments/<feature>/runs/<exp_id>/<scenario>.json` | **no** (gitignored) |
| Brain instance | `~/.mykb-experiments/<exp_id>/` | n/a (per-instance git repo) |
| vfa profile | `~/.vf-agents/profiles/e2e-<exp_id>.yaml` | n/a (cleaned by `discard`) |

## Tests

```bash
bats tests/spike/             # full harness suite
bats tests/spike/smoke.bats   # end-to-end with stubbed vfa
bats tests/spike/boundary.bats # boundary-rule lint
```

The smoke test uses a synthetic specimen + stubbed vfa, so it does not touch `~/.mykb` or run real Pi containers.

## Anatomy of a scenario

```bash
# experiments/<feature>/scenarios/<name>.sh

intent "one-line description"

prepare() {
  # Set up plausible workflow lineage. Each kb call commits as a step.
  kb work create demo "Demo"
  kb work start demo
  kb work journal "did some work"
}

stimulate() {
  # The controlled inputs. Each step invokes vfa, captures JSON, commits.
  step "first probe" --prompt "what is the current workspace?"
}

observe() {
  # Non-aborting assertions; all of them run.
  assert_llm_contains "demo"
  assert_step_status_is "completed"
  assert_branch_diff_contains "workspaces/demo/journal.jsonl"
}
```

See [`docs/experimentation-METHODOLOGY.md`](../../docs/experimentation-METHODOLOGY.md) §"Scenario shape" for the discipline (paired pos/neg, plausible-lineage setup, etc.).

## Failure inspection

When a scenario fails the harness preserves the scenario branch. To inspect:

```bash
cd ~/.mykb-experiments/<exp_id>/
git log e2e/<scenario>            # step commits with prompts
git diff e2e/source e2e/<scenario>-end -- workspaces/  # what mutated
cat .e2e-steps/<scenario>/001-<name>.json | jq         # captured step output
```

The result file at `experiments/<feature>/runs/<exp_id>/<scenario>.json` has the failure messages collected by `assert_*` calls.
