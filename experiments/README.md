# experiments/

Per-feature spec-driven experiments for **Layer 4 behavioral validation**. Each subdirectory is one feature; each feature has a behavior-matrix spec and bash scenarios that the kb-spike harness runs against an isolated brain instance.

> **Methodology:** `docs/experimentation-METHODOLOGY.md` — read this before adding or modifying experiments.
>
> **Manifesto integration:** `docs/development-MANIFESTO.md` Layer 4 — when an experiment is required.
>
> **Harness:** `scripts/spike/kb-spike` — the operator commands.

## Layout

```
experiments/
├── README.md                       ← you are here
└── <feature>/
    ├── EXPERIMENT.md               ← spec: intent + behavior matrix + scenarios index
    ├── scenarios/
    │   ├── <scenario>.sh           ← prepare / stimulate / observe
    │   └── ...
    └── runs/                       ← gitignored — local run history
```

## What lives here vs. elsewhere

- **In experiments/:** the spec (`EXPERIMENT.md`) and the scenarios. Both are durable artifacts that ship with the feature in mykb's git.
- **Not in experiments/:** the kb-spike harness (lives at `scripts/spike/`), the brain instances themselves (live at `~/.mykb-experiments/<exp-id>/`, gitignored), the run records produced when scenarios execute (under `runs/`, gitignored).

## When to add an experiment

When the feature touches Layer 4 — i.e., when it can only be validated by a real Pi running against a real brain. Hooks, context injection, scorer changes, signal capture, side-effect counters. See `development-MANIFESTO.md` §3 and the methodology doc for the full rule.

If a feature is purely internal (pure logic, CLI mechanics) and Layers 1–2 cover it, no experiment is needed.

## Adding a new experiment

1. Create `experiments/<feature>/` and write `EXPERIMENT.md` with intent + behavior matrix.
2. For each row of the matrix, create a `scenarios/<row-id>.sh`. Pair positive/negative for behavior-counting features.
3. Run `bash scripts/spike/kb-spike new --experiment <feature>` to spawn an instance, then `run-scenario` for each scenario. Iterate until they pass.
4. Commit. The experiment becomes part of the regression suite for the feature.

A successful interactive spike can be promoted to a scripted scenario via `kb-spike promote <exp-id> --as <scenario-name>`.
