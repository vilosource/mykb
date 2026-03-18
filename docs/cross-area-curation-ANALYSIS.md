# Cross-Area Curation Analysis

Date: 2026-03-18
Status: Complete
Related: [Curator Research](curator-autonomous-knowledge-curation-RESEARCH.md), [Context Rendering Gap](context-rendering-gap-ANALYSIS.md)

## Purpose

Systematic curation of all 34 mykb knowledge areas to:
1. Reduce knowledge entropy (sprawl, conflicts, staleness, fragmentation)
2. Identify cross-cutting patterns that inform Curator design
3. Measure the "curation profile" of each area type (customer project, infrastructure, tooling)
4. Discover retrieval improvement opportunities beyond rendering changes

---

## Curation Results

### Full Results Table

| Area | Category | Before | Active | Established | Archived | Reduction | Curated? |
|------|----------|--------|--------|-------------|----------|-----------|----------|
| stark-picking | Customer | 32 | 14 | 3 | 20 | 63% | Deep manual |
| dsw | Customer | 65 | 33 | 8 | 27 | 52% | Deep manual |
| transval | Customer | 39 | 10 | 15 | 18 | 77% | Agent |
| tvv | Customer | 39 | 11 | 21 | 8 | 73% | Agent |
| chiller | Customer | 37 | 21 | 4 | 16 | 49% | Agent |
| compass-group | Customer | 69 | 46 | 6 | 19 | 36% | Agent |
| postnord | Customer | 63 | 43 | 0 | 23 | 35% | Agent |
| plandent | Customer | 68 | 50 | 0 | 22 | 31% | Agent |
| budgetsport | Customer | 82 | 84 | 0 | 7 | 8% | Agent (light) |
| karkkainen | Customer | 163 | 153 | 0 | 11 | 7% | Agent (light) |
| stark | Customer | 12 | 9 | 0 | 0 | 0% | Agent |
| azure-platform | Infra | 25 | 16 | 8 | 2 | 39% | Agent |
| infra-dr | Infra | 30 | 18 | 9 | 3 | 40% | Agent |
| infra-storage | Infra | 28 | 25 | 3 | 0 | 11% | Agent |
| docker-swarm | Infra | 42 | 38 | 4 | 0 | 10% | Agent |
| infra-networking | Infra | 31 | 28 | 3 | 0 | 10% | Agent |
| vault | Infra | 28 | 25 | 3 | 0 | 11% | Agent |
| infra-security | Infra | 26 | 24 | 2 | 0 | 8% | Agent |
| infra-docker-stacks | Infra | 40 | 37 | 3 | 0 | 8% | Agent |
| infra-observability | Infra | 32 | 30 | 2 | 0 | 7% | Agent |
| infra-cicd | Infra | 48 | 46 | 2 | 0 | 5% | Agent |
| infra-iac | Infra | 42 | 40 | 2 | 0 | 5% | Agent |
| infra-ssl | Infra | 37 | 37 | 0 | 0 | 0% | Untouched |
| infra-vm | Infra | 13 | 13 | 0 | 0 | 0% | Untouched |
| vm-provisioning | Infra | 33 | 33 | 0 | 0 | 0% | Untouched |
| ai-dev-tooling | Tooling | 18 | 15 | 0 | 7 | 32% | Agent |
| vfa | Tooling | 63 | 49 | 4 | 12 | 25% | Agent |
| waveterm | Tooling | 31 | 27 | 4 | 0 | 13% | Agent |
| dr | Tooling | 55 | 55 | 0 | 0 | 0% | Untouched |
| mykb | Tooling | 47 | 47 | 0 | 0 | 0% | Untouched |
| software-factory | Tooling | 17 | 17 | 0 | 0 | 0% | Untouched |
| vff | Tooling | 49 | 49 | 0 | 0 | 0% | Untouched |
| vmctl | Tooling | 39 | 39 | 0 | 0 | 0% | Untouched |
| osb | Tooling | 206 | 200 | 0 | 6 | 3% | Agent (light) |

### Aggregate Statistics

- **Total entries before curation:** ~1,660
- **Total active after:** ~1,370
- **Total established:** ~105
- **Total archived:** ~215
- **Overall active reduction:** ~17%
- **Areas significantly curated (>25% reduction):** 12 of 34
- **Areas untouched or barely touched:** 14 of 34

---

## Cross-Cutting Findings

### Finding 1: Customer project areas are the most curation-responsive

Customer projects averaged 40-50% active reduction when deeply curated. They accumulate the most fragment sprawl because:
- Work happens over weeks/months with incremental fact additions
- Server connectivity info is scattered (URLs, IPs, SSH keys, VPN, firewall rules — each added as separate facts as they were discovered)
- Environment-specific details (dev/test/prod) are stored as separate entries instead of one pattern
- Version/changelog entries go stale quickly

Infrastructure areas averaged only 5-10% reduction — they tend to be better structured from the start (more patterns, fewer fragments).

### Finding 2: The "environment access" cluster is universal

Every customer project area had scattered entries about how to access dev/test/prod environments. This is the #1 consolidation target across all areas:

| Area | Entries about environment access | Consolidated to |
|------|----------------------------------|----------------|
| stark-picking | 5 entries (SSH, VPN, firewall, network path) | 1 pattern |
| dsw | 9 entries (dev URLs, prod URLs, VPN, creds) | 1 pattern |
| chiller | Similar pattern found | Consolidated by agent |
| postnord | Similar pattern found | Consolidated by agent |
| compass-group | Similar pattern found | Consolidated by agent |

**Curator design implication:** When a new customer project area is created, the Curator should proactively suggest creating an "environment access" pattern after the 3rd access-related fact is added.

### Finding 3: Database/config fragments follow a predictable pattern

Across DSW, postnord, karkkainen, and other areas, database details follow the same fragmentation pattern:
- One fact for DB name/user
- One fact for how to access the DB
- One fact for backup command
- Sometimes a 4th for the auth/gateway DB

These should always be one pattern. The Curator can detect this cluster by looking for entries tagged `#database` or containing "postgres", "psql", "pg_dump", "db" in the same area.

### Finding 4: Stale-by-nature entries are a distinct class

Certain entries are inherently volatile and will go stale:
- **Version numbers:** "Current version: Backend 1.1.12" — stale after next release
- **Changelog/recent changes:** "Recent changes: DSW-163, DSW-164" — stale after next sprint
- **Jira backlog items:** "KARAWH-2573: In Progress" — stale when ticket status changes
- **Planning language:** "this will be the second VM" — stale after deployment
- **Rename/migration history:** "renamed X to Y" — stale after transition completes

The Curator should flag these at write time (based on keywords like "current version", "recent changes", "in progress", "will be") and set a provenance expiry date.

### Finding 5: Zone usage was zero before curation

Every area had 100% of entries in `active` zone. The `established` and `archive` zones existed but were never used. This means:
- The knowledge lifecycle (active → established → archive) is defined but not practiced
- No entries were ever promoted or archived organically
- The Curator's primary value may simply be enforcing zone lifecycle

### Finding 6: Large areas resist automated curation

Karkkainen (163 entries) and OSB (206 entries) had minimal reduction (7% and 3%) even with agent curation. Reasons:
- Too many entries for the agent to process thoroughly in one pass
- Domain complexity makes it hard to identify overlaps without deep understanding
- Large areas need multiple focused passes rather than one comprehensive sweep

**Curator design implication:** For areas with >50 entries, the Curator should work in focused sub-passes (by tag cluster) rather than trying to curate the whole area at once.

### Finding 7: Generic entries leak into project-specific areas

Multiple areas contained generic infrastructure knowledge:
- stark-picking: Terraform training link, ubuntu-vm module link, gitlab-runners link
- dsw: "Docker Compose per service" pattern (not DSW-specific)
- Various: generic Vault patterns, generic CI/CD patterns

The Curator should detect when an entry's content doesn't mention the area's project name or domain terms, and suggest moving it to the appropriate infrastructure area.

### Finding 8: The richest areas already had patterns

Areas that were easiest to curate (transval 77%, tvv 73%) already had well-structured pattern entries. Areas that were hardest (budgetsport 8%, karkkainen 7%) had mostly facts and few patterns.

**Pattern count correlates with curability:**
- High pattern ratio → well-organized → light curation needed
- Low pattern ratio → fragment-heavy → significant consolidation needed

The Curator should track the pattern-to-fact ratio as a health metric. Areas where facts outnumber patterns 10:1 are ripe for consolidation.

---

## Curation Profile Taxonomy

Based on curating 34 areas, we identified 4 distinct curation profiles:

### Profile A: Conflicting Fragments
**Example:** stark-picking
**Signature:** Multiple entries about the same topic with different/contradictory values
**Risk:** AI uses wrong value (the incident that started this research)
**Curator action:** Detect value conflicts, suggest supersession
**Frequency:** Rare but high-impact

### Profile B: Non-Conflicting Fragments
**Example:** dsw, most customer projects
**Signature:** Many small entries that are individually correct but scattered
**Risk:** AI has to mentally join fragments, may miss details
**Curator action:** Detect topic clusters, suggest consolidation into patterns
**Frequency:** Very common, especially in customer projects

### Profile C: Stale Accumulation
**Example:** karkkainen (Jira backlog items), dsw (version numbers)
**Signature:** Entries that were accurate when written but have since become outdated
**Risk:** AI acts on stale information
**Curator action:** Detect volatile keywords, set expiry, flag for review
**Frequency:** Common in active projects with frequent releases

### Profile D: Well-Structured
**Example:** transval, tvv, infrastructure areas
**Signature:** Good pattern-to-fact ratio, clear tagging, minimal overlap
**Risk:** Low — mainly lifecycle management (promoting established, archiving completed)
**Curator action:** Light touch — zone promotion, occasional tag cleanup
**Frequency:** Common in areas that were set up carefully or curated previously

---

## Retrieval Improvement Recommendations

Based on the curation findings, these improvements would have the highest impact on knowledge retrieval quality:

### 1. Zone-aware loading (BUG FIX — immediate)

`store.loadArea()` in scorer.ts and kb-command.ts loads all zones. Archived entries appear in AI context. This completely undermines the curation work done in this analysis.

**Fix:** Default `loadArea()` to `zone: 'active'` unless explicitly overridden. Consider loading `established` zone too (it contains stable reference data).

### 2. Pattern-first ordering

When loading entries, patterns should appear before facts. Patterns are authoritative consolidations; facts are incremental fragments. The AI should see patterns first.

**Current:** Entries ordered by ID (creation time)
**Proposed:** Order by type priority: pattern > gotcha > decision > fact > link

### 3. Curation health metrics

Expose area health indicators that trigger curation:
- **Pattern-to-fact ratio:** Below 1:5 → suggest consolidation
- **Unverified percentage:** Above 80% → suggest verification pass
- **Active entry count:** Above 30 → suggest review
- **Volatile entry count:** Entries with stale-prone keywords → flag for expiry

### 4. Proactive pattern creation prompts

When the 3rd+ fact about a topic (detected by tag overlap or FTS5 similarity) is added to an area, suggest: "You have 3 entries about [topic]. Consider creating a consolidated pattern."

### 5. Environment access template

Since every customer project needs an "environment access" pattern, provide a template that prompts for: dev URL, test URL, prod URL, VPN/access method, credentials location, network path, firewall constraints.

---

## The Missing Dimension: Retrieval-Optimized Curation

The curation work above optimized for **knowledge quality** — reducing sprawl, archiving stale entries, consolidating fragments. But the original incident wasn't a quality problem — the correct information *existed* and was *loaded*. The AI couldn't **find and trust** it among the noise.

Quality curation and retrieval optimization are different objectives:

| Objective | What it optimizes | Example |
|-----------|------------------|---------|
| Quality curation | Knowledge is accurate, non-redundant, well-typed | Consolidate 5 SSH facts into 1 pattern |
| Retrieval optimization | The right entry surfaces when the AI needs it | When the AI is about to SSH, the access pattern is the first thing it sees |

The curation agents reduced entry counts by 40-50% — but a curated area with 14 flat bullets is still a flat list. The AI still scans linearly. The critical question is: **does the curation make retrieval more likely to succeed?**

### Where curation helps retrieval

1. **Fewer entries = less noise.** 14 entries is easier to scan than 32. Probability of finding the right entry increases.
2. **Patterns are self-contained.** The AI doesn't need to mentally join 5 facts — one pattern has everything.
3. **No conflicting values.** After consolidation, there's one hostname, not two competing ones.

### Where curation does NOT help retrieval

1. **Ordering is unchanged.** Entries are still ordered by ID (creation time). The new patterns we created get high IDs — they appear LAST in the list.
2. **Type information is invisible.** We carefully used the `pattern` type, but the renderer doesn't show types. Our patterns render identically to facts.
3. **Tags aren't used for matching.** We added tags like `#ssh` and `#access` to the server access pattern, but the Tier 2 scorer matches against area summaries, not entry tags.
4. **The zone filter bug means archived entries still appear.** Until this is fixed, all curation is invisible to the AI.

### A retrieval-optimized curation protocol

The 10-point checklist should be extended with 4 retrieval-specific checks:

11. **Scanability:** Is the actionable value (FQDN, IP, command) at the START of the entry text, or buried in a long sentence? The AI reads left-to-right; front-load the critical value.
12. **Search relevance:** Would the entry be found by likely search terms? If someone searches "SSH dev server", does FTS5 match this entry? Add keywords that match how the information would be searched for, not just how it was recorded.
13. **Scoring alignment:** Are the entry's tags aligned with the signals the scorer collects? If the user's intent will produce the signal "ssh" or "server", does this entry have tags that match?
14. **Conflict resolution:** After consolidation, is there exactly ONE authoritative entry for each operational topic? No remaining entries that could provide a competing (wrong) answer?

### Concrete example: the stark-picking server access pattern

**What we created:**
```
Stark server access: Dev: ansible@stark-pda-1.dev.optiscangroup.com (ProxyJump vpn-egress-1, key ~/.ssh/stark-pda-2026)...
```

**Retrieval assessment:**
- Scanability: The FQDN appears 30 characters into the text, after "Dev: ansible@". The AI scanning for a hostname would find it, but "Stark server access:" is the first thing seen — that's good, it immediately signals what this entry is about.
- Search relevance: Contains "ssh", "server", "access", "dev", "ansible", "stark" — matches many likely queries.
- Scoring alignment: Tagged `#ssh #access #networking` — good match for connection-related signals.
- Conflict resolution: The 5 original entries (including the wrong short hostname) are archived. Only this pattern exists as active. **But the zone filter bug means the archived entries still appear in context.**

**The zone filter bug is the single biggest retrieval problem.** Until it's fixed, all curation work is undermined.

### Recommendation: Curation must optimize for retrieval, not just tidiness

The Curator should not just consolidate and archive — it should verify that the curated knowledge is **retrievable**. After every curation action, the Curator should:

1. Verify the new/updated entry would be found by FTS5 for likely queries
2. Verify no competing (archived) entries would still surface (requires zone filter fix)
3. Verify the actionable value is front-loaded in the entry text
4. Verify the entry's tags match the scoring system's signal vocabulary

---

## Impact on Curator Design

This cross-area curation exercise validates the Curator research direction with empirical data:

### Validated assumptions
- Knowledge entropy is real and measurable (51% average reduction in curated areas)
- Fragmentation is the dominant problem (Profile B), not conflicts (Profile A)
- Zone lifecycle is not practiced without enforcement (0% usage before curation)
- Large areas need focused sub-passes, not comprehensive sweeps

### New design requirements from this exercise
1. **Curation profiles should drive strategy** — the Curator should detect which profile an area matches and apply the appropriate curation strategy
2. **Pattern-to-fact ratio is a leading indicator** — use it to prioritize which areas to curate
3. **Volatile entry detection is high-value, low-effort** — keyword-based flagging at write time catches stale entries early
4. **Environment access is a known consolidation target** — the Curator can have specialized templates for common cluster types
5. **Agent-based curation at scale needs multiple passes** — single-pass curation is insufficient for areas >50 entries

### Revised trust level recommendations
Based on the profiles observed:
- `auto` is safe for: flagging volatile entries, zone promotion of stable facts, detecting generic entries in project-specific areas
- `suggest` is appropriate for: consolidation into patterns, supersession of conflicting entries
- `manual` is required for: large area curation (>50 entries), cross-area entry relocation

---

## Related Documents

- [Context Rendering Gap Analysis](context-rendering-gap-ANALYSIS.md) — The incident that triggered this research
- [Curator Research](curator-autonomous-knowledge-curation-RESEARCH.md) — Autonomous curation system design
- [Journal-Knowledge Gap Analysis](journal-knowledge-gap-ANALYSIS.md) — Adjacent problem: knowledge not extracted from journals
