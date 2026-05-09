# Standards Export — AGENTS.md and Agent Skills

> Status: design — implements §16 commitment 4 from `v2-harness-memory-RESEARCH.md`.
> Companion docs: `envelope-v2-DESIGN.md`.

## Problem

The industry has converged on two harness-portability standards:

- **AGENTS.md** — repo-root markdown file that any agent harness (Claude Code, Cursor, Aider, Copilot Workspace, …) reads to discover project conventions, build commands, test commands, and house style.
- **Agent Skills** — Anthropic's directory-based skill packaging (a folder per skill with `SKILL.md` + assets + scripts), discovered by harness convention.

mykb already holds the same kind of content the standards expect: facts, decisions, gotchas, patterns, links — organized by area, scoped per workspace. Currently this content reaches an LLM only through Claude Code via the hook in `src/extension/hooks/context.ts` and the `kb load` CLI. A user opening the same repo in Cursor, or running an agent against the same workspace from a CI runner, sees none of it.

Two options to bridge this:

1. **Read the standards' files into mykb.** Parse `AGENTS.md` in any repo we touch, treat it as another input source.
2. **Write mykb content out as standards files.** Generate `AGENTS.md` (and a `.claude/skills/` directory) from the kb so other harnesses pick it up natively.

The research brief (§4) commits to option 2: **one-way export**, kb is the source of truth, standards files are derived artifacts. This avoids dual-write (the dual-write problem already bit OSB v1, see `docs/workspaces-RETROSPECTIVE.md`) and matches the curator's existing model — kb is the canonical store, everything else is rendered output.

## Current state

- `src/core/render.ts` already renders areas as markdown for the existing hook. The same machinery is reusable.
- No exports are written to disk today. Hook-rendered content lives in the conversation context and disappears at session end.
- `~/.mykb/manifest.json` enumerates areas; this is the natural index for an exporter.

## Proposed design

A new module `src/core/exporters/` with one exporter per standard. Both exporters produce idempotent output: running them twice with no kb changes produces byte-identical files.

### `AGENTS.md` exporter

Entry point: `kb export agents <repo-path>`.

Resolves the workspace linked to `<repo-path>` (using the repo→workspace mapping from `docs/workspace-repo-resolution-ANALYSIS.md` once that lands; until then, by explicit `--workspace <id>` flag). Renders an `AGENTS.md` at `<repo-path>/AGENTS.md` with this shape:

```markdown
# AGENTS.md

> Generated from mykb workspace `<id>` on <date>. Do not edit by hand — changes will be overwritten on the next `kb export agents` run. Edit the kb instead (`kb add … <area>`).

## Project context

<workspace.name>: <workspace.summary or first paragraph of handoff>

## Build / test / run

<extracted from patterns tagged `build`, `test`, `run`, in that order>

## Conventions

<facts and patterns from areas linked to the workspace, filtered to entries with trust=operator (per envelope-v2-DESIGN.md)>

## Known issues

<gotchas from linked areas, filtered to active zone, sorted by harmful_count descending (per curator-v2-DESIGN.md)>

## See also

<link entries from linked areas>
```

The exporter respects the v2 envelope:

- Only `trust=operator` entries land in `AGENTS.md` — agent-authored or imported content stays kb-internal until reviewed.
- Entries with `valid_until < today` or `superseded_by != null` are excluded.
- Archive zone is excluded.

### Agent Skills exporter

Entry point: `kb export skills <repo-path>`.

Resolves to the same workspace. Writes to `<repo-path>/.claude/skills/`. One skill folder per workspace pattern that meets the procedural shape from `curator-v2-DESIGN.md` §2 (trigger → steps → why → verify):

```
.claude/skills/
  <pattern-id>/
    SKILL.md           # the pattern, formatted as a SKILL
    .mykb-export.json  # provenance: pattern id, area, exported-at, kb sha
```

`SKILL.md` shape:

```markdown
---
name: <pattern-derived slug>
description: <pattern.text first line>
---

# <pattern title>

<pattern body, with the trigger / steps / why / verify sections>

## Provenance

Exported from mykb pattern `<id>` in area `<area>` on <date>.
```

Only patterns are exported as skills — facts and decisions are not procedural and don't fit the SKILL format. The pattern's `helpful_count`/`harmful_count` (from `curator-v2-DESIGN.md`) are NOT exported; those are internal evidence counters, not user-facing.

The `.mykb-export.json` sidecar lets the exporter detect drift. If a user hand-edits `SKILL.md`, the next export warns and refuses to overwrite without `--force`.

### Idempotency and drift detection

Both exporters compute a content hash of every file they would write and compare against the on-disk content:

- File missing → write it.
- File matches expected hash → skip.
- File present but differs from expected → warn, refuse to overwrite, suggest `--force` or `kb update` to reconcile.

The expected hash is derived from kb state, not stored — this stays stateless across invocations.

## CLI surface

```
kb export agents [<repo-path>]      # default: cwd
kb export skills [<repo-path>]      # default: cwd
kb export all [<repo-path>]         # both, in sequence
kb export --dry-run                 # print what would be written, write nothing
kb export --force                   # overwrite hand-edited files
```

`kb export` with no subcommand prints usage. No automatic export — operator runs explicitly. (A future version could hook into `kb work stop` or git-pre-commit, but auto-export across user-edited files is exactly the dual-write problem we're avoiding; defer.)

## Storage

No new persistent storage. Both exporters are pure functions of kb state + filesystem.

The optional manifest `<repo-path>/.mykb-export-manifest.json` is written alongside the exported files to record which kb entries produced which files; this lets `kb export --dry-run` show "would update X because entry Y changed" rather than just "would update X."

## Trust gating

Tied to `envelope-v2-DESIGN.md` §2. Exports only surface `trust=operator` content because:

- `AGENTS.md` is read by every harness on every invocation; an injected agent-authored entry that snuck into the export would influence every future session before review.
- Agent Skills are autoloaded; same risk amplified.

If trust gating is not yet shipped (envelope-v2 is phased; see that doc's §Migration), the exporter falls back to `--include-unverified` requiring an explicit flag. Default is fail-closed.

## Migration

1. **`AGENTS.md` exporter ships first.** The format is text, the standard is stable, the failure mode is "the file is wrong" (recoverable). No new dependencies.
2. **`Agent Skills` exporter ships behind a flag.** SKILL packaging conventions are evolving; we treat the format as stable but the directory layout might shift across Claude Code minor versions. Gate behind `--enable-skills-export` in config until two consecutive Claude Code versions agree on the layout.
3. **Auto-export on `kb work stop`.** Deferred. Not in v2 scope.

## Backwards compatibility

- No kb schema changes.
- No effect on users who don't run `kb export`.
- Existing `kb load` and hook flows are untouched.

## Open questions

- **Repo → workspace resolution.** This depends on `docs/workspace-repo-resolution-ANALYSIS.md` (the parallel-agent's in-flight work on `develop`). Until it lands, the exporter requires `--workspace` explicitly.
- **Multi-workspace repos.** A monorepo can correspond to several workspaces (e.g. `viloforge` + `vafi` + `vfcode`). Recommend: `AGENTS.md` aggregates across all linked workspaces; `kb export skills` writes a per-workspace subdirectory under `.claude/skills/<workspace-id>/`.
- **AGENTS.md schema versioning.** The standard does not (yet) version itself. We pin the section order shown above; if the standard publishes a schema, we'll conform. Until then, our shape is opinionated but unsurprising.
- **Skills the curator authored.** Once the curator extracts pattern entries autonomously (deferred per `curator-v2-DESIGN.md` §Open), those patterns won't have `trust=operator` until reviewed. They simply won't export. This is correct fail-closed behavior; the curator's job becomes "produce candidate patterns the operator reviews and promotes."
