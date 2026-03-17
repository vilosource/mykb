# OSB to mykb Migration Guide

Practical step-by-step guide for migrating an OSB workspace to mykb. Based on the plandent migration (2026-03-17) — the first full workspace migration including knowledge, workspace metadata, journal, and documents.

## Prerequisites

### Understand the source format (OSB)

OSB stores everything in a single `BRAIN.md` per workspace:

```
~/.osb/main/brain/workspaces/<id>/
├── BRAIN.md          # YAML frontmatter + markdown sections
├── decisions.md      # Expanded decision log (secondary, not source of truth)
├── journal/          # One .md file per date (## HH:MM — text)
└── docs/             # Standalone document files
```

BRAIN.md sections:
- `## State` — key-value bullets (Phase, Active, Blocked, Next)
- `## Knowledge` — fact bullets with inline `(verified:date — source)`
- `## Decisions` — bullets with inline `Why:` and `Rejected:`
- `## Gotchas` — plain bullets
- `## Patterns` — plain bullets
- `## Links` — markdown table (Resource | Location)
- `## Documents` — filename list
- `## Journal` — date-prefixed bullets (DUPLICATED — OSB appends on every save)

### Understand the destination format (mykb)

mykb separates areas (knowledge) from workspaces (project metadata):

```
~/.mykb/
├── manifest.json                    # Area index (for Tier 1 injection)
├── kb.db                            # SQLite FTS5 cache (gitignored)
├── areas/<id>/
│   ├── area.json                    # {id, name, summary, owner, tags, created, updated}
│   ├── facts.jsonl                  # One JSON per line
│   ├── decisions.jsonl              # + why, rejected fields
│   ├── gotchas.jsonl                # + failed, resolution fields
│   ├── patterns.jsonl
│   └── links.jsonl                  # + url field
└── workspaces/<id>/
    ├── workspace.json               # {id, name, state, areas[], links{}, documents[]}
    ├── journal.jsonl                 # {date, text} per line
    └── docs/                        # Markdown files (scanned for frontmatter)
```

### Tools required

- `kb` CLI installed and working (`kb list` should respond)
- `osb` CLI or direct filesystem access to `~/.osb/main/brain/`
- Node.js (for manifest regeneration workaround)

## Pre-migration checklist

Before starting, verify:

- [ ] **Load the OSB workspace** — `osb load <id>` and review the output. Note exact counts of facts, decisions, gotchas, patterns, links, journal entries, documents.
- [ ] **Check for duplicates in OSB journal** — OSB appends journal entries on every save, creating duplicates. Count unique entries, not total lines.
- [ ] **Check BRAIN.md for multi-line entries** — Some bullets may span multiple lines. The `kb add` CLI expects a single string argument per entry.
- [ ] **Check for special characters** — Single/double quotes, angle brackets, dollar signs, backticks in fact text. These need shell escaping in the migration script. Tested safe: `' " ( ) < > | $`. Not tested: backticks, exclamation marks in bash.
- [ ] **Verify the area ID doesn't already exist** — `kb list` should not show the target area.
- [ ] **Verify the workspace ID doesn't already exist** — `kb work list` should not show the target workspace.
- [ ] **Read decisions.md separately** — It may contain expanded `Why:` and `Rejected:` text not fully captured in BRAIN.md bullet format. Use the richer source.

## Migration steps

### Step 1: Create the knowledge area

```bash
kb init area <id> "<Name>" "<one-line summary>"
```

The summary appears in the manifest and Tier 1 system prompt injection. Make it descriptive enough for an LLM to decide relevance.

### Step 2: Migrate knowledge entries

Write a bash script with sequential `kb add` commands. One command per OSB bullet.

**Facts:**
```bash
kb add fact <area> "<text>" --source "<source>" --tags "<comma,separated>"
```

Map OSB provenance `(verified:2026-03-10 — from wiki:Plandent)` to:
- `--source "wiki:Plandent"` (the source part)
- The verified date is lost — `kb add` defaults to `--unverified`. See Known Tradeoffs below.

**Decisions:**
```bash
kb add decision <area> "<text>" \
  --why "<reason>" \
  --rejected "<alternative>" \
  --source "<source>" \
  --tags "<tags>"
```

OSB format: `- PLANDENT-001: text. Why: reason. Rejected: alternative.`
Split into `--why` and `--rejected` flags. Check `decisions.md` for the full expanded text.

**Gotchas:**
```bash
kb add gotcha <area> "<text>" --source "<source>" --tags "<tags>"
```

No `--resolution` flag exists. OSB gotchas don't typically have resolutions.

**Links:**
```bash
kb add link <area> "<label>" "<url>" --source "<source>" --tags "<tags>"
```

OSB stores links in a markdown table — parse the Resource and Location columns.

**Patterns:**
```bash
kb add pattern <area> "<text>" --source "<source>" --tags "<tags>"
```

**Running the script:**
```bash
chmod +x /tmp/migrate-<id>.sh
bash /tmp/migrate-<id>.sh
```

**Verify after each type:**
```bash
wc -l ~/.mykb/areas/<id>/facts.jsonl     # Should match OSB count
wc -l ~/.mykb/areas/<id>/decisions.jsonl
wc -l ~/.mykb/areas/<id>/gotchas.jsonl
wc -l ~/.mykb/areas/<id>/links.jsonl
```

### Step 3: Create the workspace

```bash
kb work create <id> "<Name>" \
  --areas <area-id> \
  --jira "<JIRA-KEY>" \
  --wiki "<wiki-url>" \
  --repos "<repo1>,<repo2>"
```

This creates the workspace directory and `workspace.json`.

### Step 4: Activate and set state

```bash
kb work start <id>

kb work state \
  --phase "<phase>" \
  --active "<what is active>" \
  --next "<what is next>"
```

Copy the state values exactly from OSB's `## State` section.

### Step 5: Migrate journal entries

Write a bash script with `kb work journal` commands:

```bash
kb work journal "<entry text>"
```

**Important:** Deduplicate OSB journal first. OSB duplicates entries on every save. Count unique entries by comparing text content, not line count.

**Timestamps:** `kb work journal` uses the current timestamp. Original OSB dates are lost. Preserve them in the entry text (e.g., prefix with "Session 2026-03-10:").

Add a final migration marker entry:
```bash
kb work journal "Migrated from OSB to mykb on $(date +%Y-%m-%d). All knowledge, docs, and journal entries migrated. Original dates preserved in text."
```

### Step 6: Copy documents

```bash
mkdir -p ~/.mykb/workspaces/<id>/docs/
cp ~/.osb/main/brain/workspaces/<id>/docs/* ~/.mykb/workspaces/<id>/docs/
```

mykb scans workspace directories recursively for `.md` files and extracts YAML frontmatter `description:` field. OSB docs don't have frontmatter — they'll appear in the document index with null descriptions. This is fine for now; add frontmatter later if needed.

### Step 7: Fix manifest and rebuild

```bash
# Regenerate manifest (kb init area doesn't do this — known bug)
node --input-type=module -e "
import {regenerateManifest} from '$(echo ~/GitHub/mykb/dist/core/manifest.js)';
regenerateManifest('$(echo ~/.mykb)');
"

# Rebuild SQLite cache
kb rebuild
```

### Step 8: Save to git

```bash
kb save --message "Migrate <id> workspace from OSB: N facts, N decisions, N gotchas, N links, N docs, N journal entries"
```

## Verification

### Count verification

```python
# Compare entry counts
import json, os

area = os.path.expanduser('~/.mykb/areas/<id>')
for typ in ['facts', 'decisions', 'gotchas', 'patterns', 'links']:
    path = f'{area}/{typ}.jsonl'
    count = sum(1 for _ in open(path)) if os.path.exists(path) else 0
    print(f'{typ}: {count}')

# Journal count
ws = os.path.expanduser('~/.mykb/workspaces/<id>/journal.jsonl')
print(f'journal: {sum(1 for _ in open(ws))}')

# Docs count
docs = os.path.expanduser('~/.mykb/workspaces/<id>/docs/')
print(f'docs: {len(os.listdir(docs))}')
```

### Content verification

```bash
# Load the area and visually compare against osb load <id>
kb load <id>

# Show workspace state
kb work show <id>

# Test search works
kb search "<distinctive term from a fact>"
```

### Structural verification

```bash
# All entries have valid JSON
python3 -c "
import json
for typ in ['facts', 'decisions', 'gotchas', 'links']:
    with open(f'$HOME/.mykb/areas/<id>/{typ}.jsonl') as f:
        for i, line in enumerate(f):
            e = json.loads(line)
            assert e.get('id'), f'{typ} line {i} missing id'
            assert e.get('text'), f'{typ} line {i} missing text'
            assert e.get('provenance', {}).get('source'), f'{typ} line {i} missing source'
    print(f'{typ}: all entries valid')
"

# Decisions have why+rejected
python3 -c "
import json
with open(f'$HOME/.mykb/areas/<id>/decisions.jsonl') as f:
    for line in f:
        d = json.loads(line)
        assert d.get('why'), f'{d[\"text\"][:40]} missing why'
        assert d.get('rejected'), f'{d[\"text\"][:40]} missing rejected'
print('all decisions have why+rejected')
"
```

## Known tradeoffs

### Provenance dates lost

OSB facts have inline `(verified:2026-03-10 — from wiki:Plandent)`. The `kb add fact` CLI has no `--verified-date` flag — all adds default to `status: unverified`. The `kb verify <area> <id>` command sets today's date, not the original.

**Mitigation:** The original provenance text is preserved in the fact text itself (via `--source`). A future enhancement could add `--verified --verified-date` flags to `kb add`.

### Journal timestamps are migration date

`kb work journal` always uses the current timestamp. All migrated journal entries will show the migration date, not the original session date.

**Mitigation:** Preserve original dates in the journal entry text itself (e.g., "Session 2026-03-10: ...").

### No tag extraction from OSB

OSB facts don't have explicit tags. Tags in the migration script are manually assigned based on content. This is subjective and may miss some useful categorizations.

**Mitigation:** Tags can be updated later with `kb update <area> <id> --tags "new,tags"`.

### Document frontmatter missing

OSB docs are plain markdown without YAML frontmatter. mykb's document scanner returns null descriptions for these files.

**Mitigation:** Add frontmatter to docs post-migration if descriptions are needed for the document index.

## Known issues and bugs

### manifest.json not updated by `kb init area`

`createArea()` in `src/core/area.ts` does not call `regenerateManifest()`. The manifest only gets updated when `appendEntry()` auto-creates an area. After `kb init area`, the manifest stays stale.

**Impact:** Tier 1 system prompt injection won't include the new area until manifest is regenerated.

**Workaround:** Run the node one-liner in Step 7 after every migration.

**Fix:** `kb init area` should call `regenerateManifest()`. File a bug or fix in `src/cli/cli.ts` line ~105.

### `kb rebuild` doesn't regenerate manifest

`kb rebuild` only rebuilds the SQLite database. It does not touch `manifest.json`.

**Impact:** Running `kb rebuild` alone after creating a new area won't fix a stale manifest.

### FTS5 search fails on hyphenated terms

Searching for terms like "PLANDENT-004" causes a SQLite error (`no such column: 004`). FTS5 interprets the hyphen as a column operator.

**Impact:** Cannot search for decision IDs or other hyphenated identifiers directly.

**Workaround:** Quote the search term or search for a substring without the hyphen.

### `kb work link` doesn't validate area existence

`kb work link <area>` silently succeeds even if the area doesn't exist. A typo in the area ID creates a broken link.

**Impact:** Workspace may reference a nonexistent area, causing silent failures in scorer boost and context injection.

**Workaround:** Always verify with `kb list` before linking.

### Shell quoting edge cases

Tested safe in bash: `' " ( ) < > | $`

Not tested: backticks `` ` ``, exclamation marks `!` in non-interactive bash, heredoc-style multiline text, null bytes, unicode emoji. If a fact contains these, test a single `kb add` manually before scripting.

## OSB workspaces remaining to migrate

As of 2026-03-17, the following OSB workspaces have not been migrated:

| ID | Description | Estimated effort |
|----|-------------|-----------------|
| budgetsport | Budget Sport | Small |
| chiller | Chiller Fieldwork | Small |
| compass-group | Compass Group | Small |
| dr | Disaster Recovery | Medium (infra knowledge) |
| dsw | Danisco Sweeteners | Small |
| karkkainen | Karkkainen | Medium (similar to plandent) |
| osb | OpenSecondBrain | Medium (self-referential) |
| postnord | PostNord Abakus Warehouse | Medium |
| stark-picking | Stark Picking Dashboard | Small |
| transval | Transval Warehouse | Medium |
| tvv | TVV Warehouse | Medium |
| vfa | vf-agents | Medium |
| vff | ViloForgeFactory | Medium |
| vm-provisioning | VM Provisioning | Small |
| vmctl | vmctl | Small |
| vmgate | VMGate | Small |

**Tip:** For each migration, load the OSB workspace first (`osb load <id>`) and count entries before writing the migration script. Some workspaces may be nearly empty.

## Migration script template

```bash
#!/bin/bash
set -e

AREA="<id>"
NAME="<Name>"
SUMMARY="<one-line summary>"

# Step 1: Create area
kb init area "$AREA" "$NAME" "$SUMMARY"

# Step 2: Facts (one per line, copy from OSB)
kb add fact "$AREA" "<text>" --source "<source>" --tags "<tags>"
# ... repeat for each fact

# Step 3: Decisions
kb add decision "$AREA" "<text>" --why "<why>" --rejected "<rejected>" --source "<source>"
# ... repeat

# Step 4: Gotchas
kb add gotcha "$AREA" "<text>" --source "<source>" --tags "<tags>"
# ... repeat

# Step 5: Links
kb add link "$AREA" "<label>" "<url>" --source "<source>"
# ... repeat

echo "=== Knowledge migration complete ==="
echo "Next: create workspace, set state, migrate journal, copy docs"
```
