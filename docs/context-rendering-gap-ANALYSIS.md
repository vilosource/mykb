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

## Effectiveness Analysis: Would Each Solution Have Prevented the Incident?

The incident: 29 flat bullets loaded, two referenced `stark-pda-1.dev` (short), one referenced `stark-pda-1.dev.optiscangroup.com` (FQDN). The AI picked the short form. Would each proposed solution have changed the outcome?

### Solution 1: Type-Grouped Rendering — Probably not

The FQDN and the short hostname are both stored as **facts**. Type grouping would place them in the same `### Facts` section with identical visual weight. Unless someone had proactively written the connection info as a **pattern** entry, the grouping adds no disambiguation.

Where type grouping does help: if gotchas like "Stark firewall blocks outbound SSH" and patterns like "how to connect" existed, they would appear before the wall of facts. The AI would read actionable guidance before trivia. But this relies on the knowledge author using the right entry types — it doesn't help when the problem is conflicting facts.

**Verdict: Helps with actionable knowledge surfacing, does not resolve conflicting facts.**

### Solution 2: Tag-Clustered Rendering — Partially

Tag clustering would co-locate SSH-related entries. Instead of the FQDN being buried at position 25 of 29, it would appear next to the SSH key info and the short hostname — all under `### ssh / access`. The AI would see the conflict immediately and could reason about which is correct.

But co-location doesn't resolve the conflict. Two bullet points saying different hostnames, side by side, still have equal weight. The AI must still guess or cross-reference with the rename fact.

**Verdict: Makes conflicts visible but doesn't resolve them. Reduces the chance of missing information, doesn't eliminate it.**

### Solution 3: Relevance-Ranked Loading — Uncertain

If the user says "the app is unreachable on the dev server," FTS5 would boost entries containing "dev," "server." Both the short hostname and the FQDN entries contain "dev." BM25 keyword matching has no notion of correctness — it ranks by term frequency, not by which value is right.

Relevance ranking helps when the problem is that the right entry is buried below irrelevant ones. It does not help when two entries give conflicting answers with similar keyword relevance.

Additionally, this solution only applies to Tier 2 (automatic context injection). When the user explicitly runs `kb load stark-picking` (Tier 3), there are no signals to rank by — the user asked for everything.

**Verdict: Helps surface relevant entries in Tier 2 automatic injection. Does not resolve conflicting information. No effect on explicit `kb load`.**

### Solution 4: Provenance-Aware Rendering — Only with discipline

If the FQDN fact had been marked `verified` and the short hostname fact marked `stale`, the AI would see:

```
- [verified] Target VM: stark-pda-1.dev.optiscangroup.com ...
- [stale] azure-vm-base role applied to dev VM (stark-pda-1.dev) ...
```

This would clearly indicate which value to trust. But in practice, neither entry had provenance set — both were `unverified` (the default). Provenance-aware rendering only works when the knowledge author maintains provenance hygiene. The current incident had no provenance differentiation to render.

**Verdict: Powerful when provenance is maintained. Useless when entries are all unverified (the common case today).**

### Solution 5: Composite Entry Support — Yes, directly

If instead of 5 scattered facts about server access, there was a single composite pattern entry:

```
Stark server access:
  Dev:  ansible@stark-pda-1.dev.optiscangroup.com (ProxyJump vpn-egress-1)
  Test: optiscan-adm@81.175.252.94 (alias: ssh testpda-2026)
  Prod: optiscan-adm@81.175.252.93 (alias: ssh prodpda-2026)
  Note: Firewall blocks SSH (22/3322), allows HTTPS (443). Use public IPs.
```

There would be **no ambiguity**. One entry, one authoritative source, one hostname per environment. The short hostname `stark-pda-1.dev` would not exist as a competing reference because the scattered facts that mentioned it would have been consolidated and superseded.

This is also the only solution that reduces entry count. 29 entries becomes maybe 20, improving signal-to-noise for every other entry too.

**Verdict: Directly prevents this class of failure by eliminating scattered, conflicting information. The only solution that addresses the root cause rather than mitigating symptoms.**

### The uncomfortable conclusion

The root cause of this incident is not a rendering problem, an ordering problem, or a scoring problem. It is a **knowledge authoring problem**: critical operational information was stored as scattered, incrementally-added facts rather than consolidated, authoritative entries.

The rendering system made the problem worse by presenting all entries with equal visual weight. But even a perfect renderer cannot resolve conflicting information — it can only make the conflict more visible. The actual fix is to not have conflicts in the first place.

This suggests two categories of improvement:

**Category A: Better presentation (makes conflicts visible, reduces noise)**
- Type-grouped rendering — surfaces patterns/gotchas above trivia
- Tag-clustered rendering — co-locates related entries
- Provenance-aware rendering — shows confidence levels
- Relevance-ranked loading — prioritizes contextually relevant entries

**Category B: Better knowledge structure (eliminates conflicts)**
- Composite entries — consolidate scattered facts into authoritative references
- Knowledge consolidation workflow — detect when multiple entries cover the same topic and prompt for merging
- Supersession — when adding a fact that corrects an older fact, mark the old one as stale or delete it

Category A improvements make the system more resilient to imperfect knowledge. Category B improvements make the knowledge itself better. Both matter, but Category B is what actually prevents this class of incident.

---

## System Impact Analysis

The proposed solutions affect a rendering pipeline consumed across the entire mykb system. Any change to `renderEntryLine()` or `renderMarkdown()` ripples through 17 call sites in 9 source files and 50+ test assertions.

### Token budget mismatch

The scorer estimates token cost as `entry.text.length / 4` (scorer.ts:162), ignoring rendering overhead (bullets, tags, headers, XML wrapper). Currently the undercount is ~10-15%. Solutions that add type prefixes, section headers, and provenance markers could push this to 30-40%, causing the scorer to select more entries than actually fit in the Tier 2 token budget.

Any solution that adds rendering metadata must synchronize the token estimation.

### Rendering consumers

The render functions are called from 17 sites across CLI commands, extension tools, and all three context injection tiers. Only Tier 2 (context injection via `renderContextBlock()`) is token-limited. CLI and Tier 3 have no token constraints.

This asymmetry suggests **tier-specific rendering** as a prerequisite: a compact format for the token-constrained Tier 2 path, and a richer format for CLI and Tier 3 where space is not a concern.

---

## Recommended Implementation Order

| Priority | Solution | Category | Rationale |
|----------|----------|----------|-----------|
| 1 | Composite Entry Support + consolidation workflow | B (structure) | Directly prevents the incident class. Eliminates scattered, conflicting facts. Reduces entry count. |
| 2 | Type-Grouped Rendering | A (presentation) | Surfaces patterns and gotchas above facts. Makes entry types visible. Most impactful presentation change. |
| 3 | Provenance-Aware Rendering | A (presentation) | Makes confidence levels visible. Pairs naturally with type grouping. |
| 4 | Tag-Clustered Rendering | A (presentation) | Co-locates related entries. Can combine with type grouping for maximum structure. |
| 5 | Relevance-Ranked Loading | A (presentation) | Most complex. Greatest long-term scaling benefit for Tier 2 injection. |

**Prerequisites for solutions 2-5:** Decouple token estimation from rendering. Consider tier-specific rendering to avoid blowing Tier 2 budget.

**Key insight:** Solution 1 (composite entries) is primarily a knowledge authoring practice, not a code change. It can start immediately — no code changes required. The renderer already supports multi-line text. The improvement comes from writing better entries and consolidating scattered facts, not from changing the system.

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
