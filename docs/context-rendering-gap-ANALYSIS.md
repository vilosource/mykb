# Context Rendering Gap — Analysis & Proposed Solutions

Date: 2026-03-18

## Incident

While troubleshooting an unreachable application on the Stark dev server, the AI attempted to SSH to `stark-pda-1.dev` — a short hostname that doesn't resolve — instead of the correct FQDN `stark-pda-1.dev.optiscangroup.com`. The knowledge base had been loaded (`kb load stark-picking`) and the correct FQDN was present in the loaded entries. The AI still used the wrong hostname.

This is not a data quality problem. The data was correct, loaded, and in context. The AI failed to extract and use the right value from a flat wall of 29 undifferentiated bullet points.

---

## Problem Description

### What the AI received

When `kb load stark-picking` renders, the output is 29 flat bullet points:

```
## stark-picking (Active)
- Wiki #wiki
- Test/prod servers: Ubuntu 24.04 LTS, VMware ... #server #hardware
- Legacy Stark servers still operational: Prod 81.175.252.83 ... #server #legacy
- Extdev VNet: vnet-extdev-services-dev-swedencentral-01 ... #networking #vnet
  ... (25 more entries in identical format)
- Dev VM renamed: stark-pd-1.dev -> stark-pda-1.dev.optiscangroup.com #vm #rename
```

The FQDN appeared in 2 of 29 entries. The incorrect short form `stark-pda-1.dev` appeared in another entry. All three lines had identical visual weight — same indent, same bullet, same format.

### Why the AI failed

1. **Flat rendering eliminates hierarchy.** Every entry — whether a critical connection pattern, a trivia fact, or a stale reference — renders as `- text #tags`. There is no visual signal for importance, type, or recency.

2. **Conflicting information has equal weight.** The short hostname `stark-pda-1.dev` and the FQDN `stark-pda-1.dev.optiscangroup.com` both appear as facts with no indicator of which supersedes the other. The rename fact exists but is buried.

3. **No semantic grouping.** SSH connection info is scattered across entries tagged `#ssh`, `#server`, `#vm`, `#rename`, `#networking`. When the AI needs to "connect to the dev server," there is no cluster of related entries to scan — the relevant facts are dispersed among infrastructure specs, Terraform references, and VM inventory details.

4. **Rich metadata is discarded at render time.** Each entry carries type (fact/decision/gotcha/pattern), zone (active/established/archive), provenance (verified/unverified/stale), timestamps, and type-specific fields (decision rationale, gotcha resolution, link URLs). The renderer throws all of this away.

---

## Root Cause Analysis

### The rendering bottleneck

All three rendering paths — `renderMarkdown()`, `renderContextBlock()`, and the search renderer — funnel through a single function:

```typescript
// render.ts:8-20
function renderEntryLine(entry: KnowledgeEntry): string {
  let line = `- ${entry.text}`;
  if (entry.tags.length > 0) {
    line += ' ' + entry.tags.map((t) => `#${t}`).join(' ');
  }
  if (entry.provenance.status === ProvenanceStatus.Verified && entry.provenance.date) {
    line += ` (verified:${entry.provenance.date})`;
  }
  return line;
}
```

This function discards:

| Metadata | Available | Rendered |
|----------|-----------|----------|
| Entry type (fact/decision/gotcha/pattern/link) | Yes | No |
| Zone (active/established/archive) | Yes | Header only |
| Provenance status (unverified/stale/expires) | Yes | No (only verified shown) |
| Provenance source | Yes | No |
| Decision rationale (`why`, `rejected`) | Yes | No |
| Gotcha resolution status | Yes | No |
| Link URL | Yes | No |
| Created/updated timestamps | Yes | No |

### The ordering problem

Entries are queried with `ORDER BY id` (db.ts:268). IDs are ULIDs (time-ordered), so entries appear in creation order. There is no reordering by:

- Entry type (patterns and gotchas before trivia facts)
- Provenance status (verified before unverified)
- Recency (recently updated before stale)
- Relevance to current context

### The token budget problem

Context injection (Tier 2) loads entries up to a token budget (default 2000 tokens). Entries are consumed in ID order. If an area has 29 entries and the budget allows 20, the last 9 entries are silently dropped. Recently added entries (high IDs) are the most likely to be cut — exactly the entries most likely to contain current, corrected information.

### The area-level scoring limitation

The scorer (`scorer.ts`) ranks entire areas by relevance but does not rank entries within an area. Once an area is selected, all its entries are treated as equally important. There is no mechanism to boost an SSH-related entry when the user's intent is clearly about connecting to a server.

---

## Impact Beyond This Incident

This is not a Stark-specific problem. It affects every knowledge area as it grows:

1. **Scaling wall.** Areas work well at 5-10 entries. At 20+, the flat rendering becomes a wall of text that degrades AI comprehension. Areas will only grow over time.

2. **Knowledge quality doesn't matter.** Well-written facts with good provenance and accurate tags are rendered identically to quick unverified notes. There is no incentive (from the AI's perspective) to maintain knowledge quality because the renderer can't distinguish quality.

3. **Patterns and gotchas are invisible.** A carefully written pattern ("how to connect to Stark servers") renders the same as a trivia fact ("other VMs in extdev group: plandent-1, sok-1..."). Patterns and gotchas are meant to be actionable — the current rendering buries them.

4. **Decisions lose their rationale.** Decision entries carry `why`, `rejected`, and `context` fields that are never rendered. The AI sees the decision text but not the reasoning, making it impossible to apply the decision correctly in edge cases.

5. **Token budget silently drops recent entries.** The most recently added entries — which are most likely to contain corrections and updates — are the first to be cut when the budget is tight.

---

## Proposed Solutions

### Solution 1: Type-Grouped Rendering

**Effort: Low | Impact: High**

Group entries by type within each area, with visual differentiation and a defined type priority order:

```markdown
## stark-picking (Active)

### Patterns
- [PATTERN] SSH to dev: ansible@stark-pda-1.dev.optiscangroup.com via ProxyJump vpn-egress-1

### Gotchas
- [GOTCHA] TESTPDA-2026 has asymmetric NAT: inbound on .94, outbound on .115
- [GOTCHA] Stark firewall blocks outbound SSH (22/3322) but allows HTTPS (443)

### Decisions
- [DECISION] Deploy via Docker from Harbor. Dev=ansible user, test/prod=optiscan-adm.
  Why: ...

### Facts
- Target VM: stark-pda-1.dev.optiscangroup.com in rg-extdev-services-dev-swedencentral-01
- Dev VM renamed: stark-pd-1.dev -> stark-pda-1.dev.optiscangroup.com
  ... (remaining facts)

### Links
- [LINK] Jira ticket: STARK-653 → url
```

**Why this helps:** Patterns and gotchas — the most actionable entries — appear first. The AI naturally scans the top of a section before the bottom. Type labels provide instant context for how to interpret each entry.

**Implementation:** Change `renderMarkdown()` to sort entries by type priority (pattern > gotcha > decision > fact > link) and insert type headers when the type changes. Modify `renderEntryLine()` to include type prefix for non-fact entries and render type-specific fields (decision `why`, gotcha `resolution`, link `url`).

**Files to modify:**
- `src/core/render.ts` — `renderEntryLine()`, `renderMarkdown()`, `renderContextBlock()`

### Solution 2: Tag-Clustered Rendering

**Effort: Medium | Impact: High**

Group entries by their primary tag to create semantic clusters:

```markdown
## stark-picking (Active)

### ssh / access
- SSH to dev: ansible@stark-pda-1.dev.optiscangroup.com via ProxyJump vpn-egress-1
- SSH access to new servers: user optiscan-adm, key ~/.ssh/stark-pda-2026

### networking
- TESTPDA-2026 has asymmetric NAT: inbound on .94, outbound on .115
- Stark firewall blocks outbound SSH but allows HTTPS
- Network path: Local -> Azure P2S VPN -> vpn-egress-1 -> Stark firewall -> target

### server / hardware
- Target VM: stark-pda-1.dev.optiscangroup.com in rg-extdev-services-dev-swedencentral-01
- TESTPDA-2026: public IP 81.175.252.94, internal 10.63.20.50
  ...
```

**Why this helps:** When the AI needs to SSH somewhere, it scans the `ssh / access` cluster and finds everything in one place. Related facts are co-located instead of scattered across the list.

**Implementation:** Extract primary tag (first tag) from each entry. Group by primary tag. Render groups with tag headers. Entries with no tags go into an "General" group.

**Challenge:** Tag assignment is currently ad-hoc. Effectiveness depends on consistent tagging discipline or automatic primary-tag inference.

**Files to modify:**
- `src/core/render.ts` — new grouping logic in `renderMarkdown()` and `renderContextBlock()`

### Solution 3: Relevance-Ranked Loading

**Effort: High | Impact: Very High**

Use FTS5 search ranking to reorder entries based on current context signals before rendering.

The infrastructure already exists: `searchEntries()` in db.ts uses FTS5 BM25 ranking. The scorer already collects signals (user text, file paths, tool output). The missing piece is using these signals to rank entries *within* an area, not just to select areas.

**Flow:**
1. Scorer selects relevant areas (existing behavior)
2. For each area, run FTS5 query with accumulated signals against that area's entries
3. Reorder entries by FTS5 rank (most relevant first)
4. Apply token budget to relevance-ordered entries (least relevant cut first)

**Why this helps:** If the user says "the app is unreachable on the dev server," the FTS5 query would boost entries containing "dev," "server," "app" — surfacing the FQDN and SSH entries above infrastructure trivia.

**Implementation:** Add `rankedLoadArea(area, signals)` method to the store. Modify `selectEntriesForInjection()` in scorer.ts to use ranked loading when signals are available. Fall back to type-grouped order when no signals exist.

**Files to modify:**
- `src/core/db.ts` — new `rankedQueryEntries()` function
- `src/core/knowledge-store.ts` — new `rankedLoadArea()` method
- `src/extension/scorer.ts` — `selectEntriesForInjection()` to use ranked loading

### Solution 4: Provenance-Aware Rendering

**Effort: Low | Impact: Medium**

Show provenance status for all entries, not just verified ones. Order verified entries before unverified ones within each group.

```markdown
- [verified] Target VM: stark-pda-1.dev.optiscangroup.com ...
- [verified] SSH access to new servers: user optiscan-adm ...
- Dev VM renamed: stark-pd-1.dev -> stark-pda-1.dev.optiscangroup.com
- [stale] Legacy Stark servers still operational: Prod 81.175.252.83 ...
```

**Why this helps:** The AI can weigh verified facts higher than unverified ones and deprioritize stale entries. Currently there is no way to distinguish confidence levels in the rendered output.

**Implementation:** Extend `renderEntryLine()` to show all provenance statuses. Sort entries within groups by provenance status (verified > unverified > stale > expires).

**Files to modify:**
- `src/core/render.ts` — `renderEntryLine()`

### Solution 5: Composite Entry Support

**Effort: Medium | Impact: High**

Allow and encourage multi-line entry text for complex topics that don't fit a single bullet point. The "how to connect to Stark servers" information is currently spread across 5 separate facts. A single composite pattern entry would consolidate this:

```markdown
- [PATTERN] Stark server access:
    Dev:  ansible@stark-pda-1.dev.optiscangroup.com (ProxyJump vpn-egress-1, key ~/.ssh/stark-pda-2026)
    Test: optiscan-adm@81.175.252.94 (alias: ssh testpda-2026)
    Prod: optiscan-adm@81.175.252.93 (alias: ssh prodpda-2026)
    Note: Firewall blocks SSH (22/3322), allows HTTPS (443). Use public IPs, not 10.x.
```

**Why this helps:** Instead of the AI mentally joining 5 scattered facts, it gets a single authoritative reference. This also reduces entry count, improving signal-to-noise ratio.

**Implementation:** Multi-line text is already supported in JSONL storage (newlines stored as `\n` in JSON strings). The renderer needs to handle multi-line entries with proper indentation. This is primarily a knowledge authoring practice backed by rendering support.

**Files to modify:**
- `src/core/render.ts` — handle `\n` in entry text with indentation
- Documentation — authoring guidelines for composite entries

---

## System Impact Analysis

The proposed solutions affect a rendering pipeline that is consumed across the entire mykb system. Any change to `renderEntryLine()` or `renderMarkdown()` ripples through 17 call sites in 9 source files and breaks 50+ test assertions.

### Rendering consumers

| Consumer | Function Used | Tier | Token-Limited |
|----------|--------------|------|---------------|
| CLI `kb load` | `renderMarkdown()` | — | No |
| CLI `kb search` | `renderMarkdown()` | — | No |
| CLI `kb stale` | `renderMarkdown()` | — | No |
| CLI `kb load --json` | `renderJson()` | — | No |
| CLI `kb list` | `renderAreaIndex()` | — | No |
| CLI `kb export agents-md` | `renderAreaIndex()` | — | No |
| CLI `kb work start/show` | `renderWorkspace()` | — | No |
| Tool: `kb_load` | `renderMarkdown()` | 3 | No |
| Tool: `kb_search` | `renderMarkdown()` | 3 | No |
| Tool: `kb_list` | `renderAreaIndex()` | 1 | No |
| `/kb` command handler | `renderMarkdown()` | 3 | No |
| Context injection | `renderContextBlock()` | 2 | **Yes (2000 tokens)** |
| Session start (areas) | `renderAreaIndex()` | 1 | No |
| Session start (workspace) | `renderWorkspace()` | 1 | No |

### The token budget mismatch (critical)

The scorer estimates token cost per entry as `entry.text.length / 4` (scorer.ts:162). This estimate does **not** account for any rendering overhead:

- The `- ` bullet prefix (2 chars)
- Tag rendering: ` #tag1 #tag2` (variable)
- Provenance: ` (verified:2026-03-15)` (23 chars)
- Section headers: `## area (Active)\n` (20+ chars, once per area)
- XML wrapper: `<mykb-context>...</mykb-context>` (31 chars)

Currently this undercount is small — maybe 10-15% of actual rendered size. But if we add type prefixes (`[PATTERN] `, `[GOTCHA] `, `[DECISION] `), type section headers (`### Patterns\n`), provenance markers for all statuses, and decision rationale lines, the rendering overhead could reach 30-40% of total output. The scorer would select entries believing they fit in 2000 tokens, but the rendered output would actually consume 2600-2800 tokens.

**This means every proposed solution that adds rendering metadata must also update the token estimation formula.** The scorer and renderer are currently decoupled — the scorer estimates from raw entry text, the renderer produces final output independently. This decoupling is the root fragility.

### Test blast radius

| Test file | Cases affected | What they assert |
|-----------|---------------|-----------------|
| `tests/core/render.test.ts` | 24 | Exact markdown format: `"- fact one #ts #dev"` |
| `tests/cli/cli.test.ts` | ~15 | Output contains `"##"`, specific content strings |
| `tests/tools/kb-load.test.ts` | 4 | Entry content present in markdown |
| `tests/tools/kb-search.test.ts` | 2 | Matching entries in markdown |
| `tests/extension/kb-command.test.ts` | 4 | Entry text in injected markdown |
| `tests/extension/context.test.ts` | 1 | `<mykb-context>` present, content injected |
| `tests/extension/session.test.ts` | 1 | `<mykb-workspace>` tags |
| `tests/extension/scorer.test.ts` | 1 | Token calculation = `totalChars / 4` |

The render.test.ts assertions are the most fragile — they check exact string format. Any prefix, header, or grouping change breaks them all.

### Per-solution impact

**Solution 1 (Type-Grouped Rendering):**
- Adds `### Patterns`, `### Gotchas`, etc. section headers → increases token consumption ~5-10%
- Adds `[PATTERN]`, `[GOTCHA]` prefixes → ~8-12 chars per non-fact entry
- Reorders entries (patterns first) → breaks all test assertions on entry order
- Must update: `renderEntryLine()`, `renderMarkdown()`, `renderContextBlock()`, scorer token estimate, 30+ tests

**Solution 2 (Provenance-Aware Rendering):**
- Adds `[verified]`, `[stale]` markers → ~10-12 chars per entry
- Reorders within groups → breaks order-dependent test assertions
- Must update: `renderEntryLine()`, scorer token estimate, 20+ tests

**Solution 3 (Relevance-Ranked Loading):**
- Changes entry order, not rendering format → no token impact
- Must update: `scorer.ts`, `db.ts`, `knowledge-store.ts`, scorer tests
- **Least disruptive to rendering pipeline** — affects the loading layer, not the display layer

**Solution 4 (Tag-Clustered Rendering):**
- Adds tag group headers → increases token consumption ~5-8%
- New grouping logic in `renderMarkdown()` and `renderContextBlock()`
- Must update: render functions, scorer token estimate, 30+ tests

**Solution 5 (Composite Entry Support):**
- Multi-line rendering with indentation → moderate token increase per entry
- Only affects entries that use multi-line text (opt-in)
- Must update: `renderEntryLine()`, tests for that function

### Mitigation strategies

1. **Decouple token estimation from rendering.** The scorer should estimate tokens from the *rendered* output, not raw entry text. Either render first then count, or use a `renderTokenEstimate()` function that mirrors the render logic.

2. **Tier-specific rendering.** The Tier 2 context injection (token-limited) could use a compact renderer, while Tier 3 (`/kb` command, no limit) and CLI use a rich renderer. This avoids the token budget problem for the most constrained path.

3. **Feature-flag the format change.** Add a `renderFormat: 'flat' | 'grouped'` option to render functions. Migrate tests incrementally. Default to `flat` initially, switch to `grouped` after validation.

4. **Render-then-budget approach.** Instead of estimating tokens per entry and selecting, render all entries, then truncate the rendered output to fit the budget. This ensures the token count is always accurate.

---

## Recommended Implementation Order

| Priority | Solution | Effort (revised) | Impact | Rationale |
|----------|----------|-------------------|--------|-----------|
| 0 | Decouple token estimation from rendering | Low | Critical | **Prerequisite** for all rendering changes. Without this, any format change silently breaks Tier 2 injection. |
| 1 | Relevance-Ranked Loading | Medium | Very High | Changes loading order, not rendering format. Least disruptive to the rendering pipeline. Highest impact on the original problem. |
| 2 | Tier-specific rendering | Medium | High | Enables rich rendering for CLI/Tier 3 without blowing Tier 2 token budget. Unblocks Solutions 3-5. |
| 3 | Type-Grouped Rendering | Medium | High | Now medium effort due to 30+ test updates and token estimation changes. Still high value for surfacing patterns/gotchas. |
| 4 | Provenance-Aware Rendering | Medium | Medium | Pairs with Solution 3. Token overhead manageable with tier-specific rendering in place. |
| 5 | Composite Entry Support | Medium | High | Reduces entry sprawl. Mostly a knowledge authoring practice. |
| 6 | Tag-Clustered Rendering | High | High | Most complex grouping logic. Best done after type-grouped rendering is stable. |

**Revised sequencing rationale:** The original report rated type-grouped rendering as "low effort" — this was wrong. It touches the most fragile part of the system (renderEntryLine, consumed by 17 call sites, asserted by 50+ tests) and requires synchronized updates to the scorer's token estimation. Relevance-ranked loading, by contrast, operates in the loading layer and leaves rendering untouched.

The safest path is: fix the token estimation coupling first (Priority 0), then improve entry ordering via relevance ranking (Priority 1), then introduce tier-specific rendering to decouple the constrained Tier 2 path from the unconstrained CLI/Tier 3 paths (Priority 2), and only then change the rendering format itself (Priorities 3-6).

---

## Metrics for Validation

How to know if the fix works:

1. **Retrieval accuracy test.** Load an area with 20+ entries. Ask the AI to perform a task requiring a specific entry (e.g., "SSH to the dev server"). Measure whether the correct value is used on the first attempt.

2. **Entry count scaling.** Test with areas of 10, 20, 30, 50 entries. Current rendering degrades around 20 entries. The fix should maintain accuracy to at least 50.

3. **Token efficiency.** Measure how many tokens are consumed by rendering metadata (type headers, provenance markers) vs. the current flat format. The overhead should be under 15%.

4. **Context injection coverage.** With the token budget of 2000 tokens, measure what percentage of an area's entries survive injection. Relevance ranking should ensure the most important entries are always included regardless of budget pressure.

---

## Related Documents

- [Journal-Knowledge Gap Analysis](journal-knowledge-gap-ANALYSIS.md) — Adjacent problem: knowledge not being extracted from journal entries
- [Known/Unknowns Analysis](known-unknowns-ANALYSIS.md) — Mentions tag-based sub-area retrieval as a known-known, but it was never implemented in rendering
- [Knowledge Harness Design](knowledge-harness-DESIGN.md) — Original design for the context injection system (Tier 1/2/3)
