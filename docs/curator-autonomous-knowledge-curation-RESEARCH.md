# Autonomous Knowledge Curation — Research Topic

Date: 2026-03-18
Status: Proposal
Related: [Context Rendering Gap Analysis](context-rendering-gap-ANALYSIS.md)

---

## Research Question

**Can an LLM autonomously maintain knowledge quality in a structured knowledge base over time, and what is the right trust boundary for automated curation?**

This research explores whether a "Curator" — an LLM-driven curation pipeline triggered by knowledge mutations — can reduce knowledge entropy (sprawl, conflicts, staleness) without human intervention, and what failure modes emerge when it does.

---

## Background

### The problem that motivated this research

During a troubleshooting session on the Stark project, the AI attempted to SSH to `stark-pda-1.dev` instead of the correct FQDN `stark-pda-1.dev.optiscangroup.com`. The correct hostname was present in the knowledge base, loaded into context, and visible among 29 other entries. The AI picked the wrong value.

Root cause analysis ([context-rendering-gap-ANALYSIS.md](context-rendering-gap-ANALYSIS.md)) concluded that the failure was not a rendering or retrieval problem — it was a **knowledge authoring problem**. The same information existed in multiple entries, added incrementally over weeks, with conflicting values and no mechanism to detect or resolve the conflict.

### Why this is a research topic, not just a bug fix

The immediate fix is straightforward: consolidate the scattered entries manually. But the underlying dynamic — knowledge accumulating incrementally, creating sprawl and conflicts over time — is fundamental to how AI-assisted knowledge bases work. Every `kb add` is made in isolation, with no awareness of existing content. Over time, entropy wins.

The question is whether an automated system can fight this entropy, and if so, how much autonomy it should have.

### What makes this interesting beyond mykb

- **AI-on-AI knowledge editing.** The session AI writes knowledge, a separate Curator AI refines it. This is a form of AI collaboration where one AI improves the output of another asynchronously.
- **Trust calibration.** How much should we trust an AI to modify a knowledge base without human oversight? This has implications for any system where AI manages persistent state.
- **Knowledge entropy measurement.** Can we define and measure "knowledge quality" over time? Does it degrade predictably? Does automated curation measurably improve it?

---

## Proposed System: The Curator

An event-driven curation pipeline triggered by knowledge mutations. Not a daemon — runs inline when entries are added or modified. Uses a two-stage architecture: fast local detection followed by selective LLM analysis.

### Architecture

```
Mutation event (kb add, kb update)
    │
    ▼
┌──────────────────────────────────────────────────┐
│ Stage 1: DETECT (local, no LLM, <10ms)           │
│                                                    │
│ Inputs:                                            │
│   - The new/modified entry                         │
│   - All entries in the same area (from SQLite)     │
│                                                    │
│ Checks:                                            │
│   - FTS5 similarity against area entries           │
│   - Tag overlap (2+ shared tags = related)         │
│   - Staleness (age + unverified provenance)        │
│   - Value contradictions (same tags, diff values)  │
│                                                    │
│ Output:                                            │
│   - CurationEvent[] if issues detected             │
│   - Nothing if entry is clean (common case)        │
│                                                    │
│ Performance: <10ms using existing SQLite + FTS5    │
│ Cost: zero (no LLM, no network)                    │
└────────────────────────┬─────────────────────────┘
                         │
                    (only if events detected)
                         │
                         ▼
┌──────────────────────────────────────────────────┐
│ Stage 2: ANALYZE (LLM call, ~1-2s)               │
│                                                    │
│ Inputs:                                            │
│   - The new entry                                  │
│   - The flagged overlapping entries (from Stage 1) │
│   - Area metadata (summary, entry count)           │
│                                                    │
│ The Curator LLM determines:                        │
│   - Is this a real conflict or a false positive?   │
│   - What is the recommended action?                │
│   - What is the confidence level? (0-1)            │
│                                                    │
│ Output: CurationAction[]                           │
│                                                    │
│ Model: Haiku (fast, cheap, sufficient for          │
│   structured analysis of 3-10 entries)             │
│ Prompt: narrow and focused (see Prompt Design)     │
│ Cost: ~0.001 USD per invocation                    │
└────────────────────────┬─────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────┐
│ Stage 3: ACT (based on configured trust level)    │
│                                                    │
│ observe:                                           │
│   Log action to curation_log.jsonl                 │
│   No mutations. Pure research data.                │
│                                                    │
│ suggest:                                           │
│   Write to curation_queue.jsonl                    │
│   Surface at session boundaries                    │
│   Human/AI-in-session decides                      │
│                                                    │
│ auto:                                              │
│   Apply low-risk actions directly                  │
│   Queue high-risk actions for approval             │
│   Log everything to curation_log.jsonl             │
└──────────────────────────────────────────────────┘
```

### Curation action taxonomy

The Curator can recommend these actions, each with a defined risk level:

| Action | Risk | What it does | Safe to auto-apply? |
|--------|------|-------------|---------------------|
| `no_action` | None | Logs that overlap was reviewed and is fine | Yes |
| `flag_conflict` | None | Adds a flag to the curation queue, changes no entries | Yes |
| `mark_stale` | Low | Sets provenance to `stale` on an outdated entry | Probably — low consequence if wrong |
| `supersede` | Medium | Marks old entry stale, records `superseded_by` link to new entry | Needs judgment — entries may differ in important ways |
| `merge` | High | Creates new consolidated pattern, tombstones originals | No — too much nuance, risk of losing information |

The per-action trust boundary is a key research variable. Start conservative, widen based on empirical accuracy.

### Trust levels as the research lever

The three trust levels are not just a safety mechanism — they are the experimental design:

**`observe` mode (control group)**
- Curator runs the full detect-analyze pipeline but applies no changes
- All recommendations are logged to `curation_log.jsonl` with timestamps, confidence scores, and full context
- At any point, a human can review the log and retroactively judge: was this recommendation correct?
- This mode answers: "What would the Curator do?" without any risk

**`suggest` mode (passive intervention)**
- Curator writes recommendations to `curation_queue.jsonl`
- Suggestions are surfaced at natural session boundaries:
  - `kb work show` (session start): "3 curation suggestions pending"
  - `kb save` (session end): "Curator found 2 overlaps in stark-picking"
- The human/AI-in-session decides whether to apply each suggestion
- This mode answers: "Do surfaced suggestions lead to better curation behavior?"

**`auto` mode (active intervention)**
- Curator applies actions based on per-action trust configuration
- Low-risk actions (flag_conflict, mark_stale) applied automatically
- High-risk actions (merge, supersede) queued for approval
- All actions logged with before/after state for audit
- This mode answers: "Which operations can be safely automated?"

### Prompt design for Stage 2

The Curator LLM receives a narrow, structured prompt — not the full knowledge base:

```
You are a knowledge base curator. You review entries in a structured
knowledge base for conflicts, redundancy, and staleness.

Area: {{area_id}} ({{entry_count}} entries, {{area_summary}})

New entry just added:
  [{{new_entry.id}}] type={{new_entry.type}}
  text: "{{new_entry.text}}"
  tags: {{new_entry.tags}}

Potentially overlapping entries detected by similarity search:
{{#each overlapping_entries}}
  [{{this.id}}] type={{this.type}} created={{this.created}}
  text: "{{this.text}}"
  tags: {{this.tags}}
  provenance: {{this.provenance.status}}
{{/each}}

Analyze these entries and determine:
1. Are any in genuine conflict? (same topic, contradictory values)
2. Does the new entry supersede any existing entry?
3. Should any existing entries be marked stale?
4. Could any entries be merged into a single authoritative entry?
5. Is this a false positive? (entries are related but not conflicting)

Respond with a JSON array of actions:
[
  {
    "action": "flag_conflict|mark_stale|supersede|merge|no_action",
    "target_ids": ["entry IDs affected"],
    "confidence": 0.0-1.0,
    "reason": "brief explanation"
  }
]
```

Design constraints:
- Prompt stays small: only the new entry + FTS5-flagged overlaps (typically 2-5 entries)
- Structured JSON output for reliable parsing
- Confidence score enables threshold-based auto-apply decisions
- Reason field provides audit trail

### Integration with mykb

The Curator is an extension module, not a separate system:

| Aspect | Integration point |
|--------|-------------------|
| Trigger | Post-add hook in the extension (`tool_result` for `kb_add` tool) |
| Stage 1 storage | Existing SQLite + FTS5 (no new infrastructure) |
| Stage 2 LLM | Anthropic API via SDK (same as Claude Code uses) |
| Curation log | `areas/<area>/curation_log.jsonl` (follows existing JSONL pattern) |
| Curation queue | `areas/<area>/curation_queue.jsonl` (follows existing JSONL pattern) |
| Configuration | `brain/curator.json` (trust level, model, confidence thresholds) |
| Surfacing | Existing session hooks: `kb work show`, `kb save` |
| No daemon | Runs inline on mutation events. Most invocations are Stage 1 only (<10ms). |

### Data model additions

**CurationEvent (Stage 1 output):**
```typescript
{
  id: string;              // nanoid
  trigger_entry_id: string; // the entry that triggered detection
  area: string;
  overlapping_ids: string[]; // entries flagged by FTS5/tag overlap
  detection_type: 'fts5_similarity' | 'tag_overlap' | 'staleness' | 'value_contradiction';
  created: string;          // ISO timestamp
}
```

**CurationAction (Stage 2 output):**
```typescript
{
  id: string;              // nanoid
  event_id: string;        // links to CurationEvent
  action: 'no_action' | 'flag_conflict' | 'mark_stale' | 'supersede' | 'merge';
  target_ids: string[];    // entries affected
  confidence: number;      // 0-1
  reason: string;          // LLM explanation
  suggested_text?: string; // for merge: the proposed consolidated text
  status: 'logged' | 'pending' | 'applied' | 'dismissed';
  created: string;
  resolved?: string;       // when applied or dismissed
}
```

Both stored as JSONL, git-tracked, following existing mykb conventions.

---

## Research Plan

### Phase 1: Observe (weeks 1-4)

**Goal:** Establish baseline data on curation accuracy without affecting the knowledge base.

**Setup:**
- Implement Stage 1 (detect) and Stage 2 (analyze) pipeline
- Run in `observe` mode — log all recommendations, apply nothing
- Instrument: log detection rate, LLM call rate, action distribution, confidence scores

**Measurements:**
- How often does Stage 1 fire? (What percentage of `kb add` calls trigger overlap detection?)
- What is Stage 1's false positive rate? (How often does FTS5 flag unrelated entries?)
- How often does Stage 2 agree with Stage 1? (Does the LLM filter out false positives effectively?)
- Action distribution: what does the Curator recommend most often?
- Retrospective accuracy: review logged recommendations manually — were they correct?

**Success criteria:** Stage 2 accuracy >80% on retrospective review. If below this, refine the prompt or detection thresholds before proceeding.

### Phase 2: Suggest (weeks 5-8)

**Goal:** Test whether surfaced suggestions lead to better knowledge quality.

**Setup:**
- Promote to `suggest` mode
- Implement session-boundary surfacing (in `kb work show` and `kb save`)
- Track: suggestion acceptance rate, time-to-resolution, knowledge quality before/after

**Measurements:**
- Suggestion acceptance rate: what percentage of suggestions are applied vs. dismissed?
- Are there patterns in what gets dismissed? (Indicates prompt refinement needed)
- Entry count trajectory: does the area entry count stabilize or decrease?
- Retrieval accuracy: does the AI use correct values more often after consolidation?
- Suggestion fatigue: does the acceptance rate decline over time?

**Success criteria:** >50% suggestion acceptance rate. Measurable reduction in entry count for areas with >20 entries. No reported cases of bad suggestions being applied.

### Phase 3: Selective auto (weeks 9-12)

**Goal:** Test which operations can be safely automated.

**Setup:**
- Enable `auto` for `no_action` and `flag_conflict` (zero-risk)
- Enable `auto` for `mark_stale` with confidence threshold >0.9
- Keep `merge` and `supersede` as `suggest`
- Log all auto-applied actions with before/after state

**Measurements:**
- Auto-action accuracy: were all auto-applied actions correct?
- False positive rate for auto `mark_stale`: were any entries incorrectly marked stale?
- Human override rate: how often does a human undo an auto-applied action?
- Knowledge quality trajectory: continuing improvement or plateau?

**Success criteria:** Zero bad auto-actions. If any auto-action is wrong, reduce trust level for that action type and analyze why.

---

## Risks and Open Questions

### Risk: LLM inconsistency

The Curator LLM may give different recommendations for the same input on different runs. Mitigations:
- Use temperature 0 for deterministic output
- Log all inputs and outputs for reproducibility
- Require confidence >0.8 for any auto action

### Risk: Over-consolidation

The Curator may merge entries that are superficially similar but meaningfully different. Example: "SSH key for dev server" and "SSH key for prod server" look similar but must remain separate. Mitigations:
- `merge` action is never auto-applied
- Confidence threshold for merge suggestions is high (>0.9)
- Merged entries retain `consolidated_from` provenance linking back to originals

### Risk: Curator cost at scale

If an area has 100+ entries, every `kb add` triggers an FTS5 search against all of them. Mitigations:
- Stage 1 (FTS5) is <10ms even at 10k entries — this is not a real concern
- Stage 2 (LLM) only fires when Stage 1 finds overlaps — most adds are clean
- Cost per LLM invocation is ~$0.001 with Haiku

### Open question: Semantic understanding without embeddings

FTS5 uses keyword matching (BM25). It catches "stark-pda-1.dev" overlapping with "stark-pda-1.dev.optiscangroup.com" because they share tokens. But it would miss "login credentials" overlapping with "SSH key" — semantically related, no shared keywords.

Is keyword matching sufficient for infrastructure knowledge (where terminology is consistent), or do we need embeddings for more abstract domains? This is something Phase 1 data will answer.

### Open question: Curator prompt evolution

The initial prompt is a best guess. How should it evolve based on Phase 1 data? Options:
- Manual refinement based on error analysis
- Few-shot examples from the curation log (successful recommendations become examples)
- Area-specific prompts (infrastructure areas vs. process areas may need different heuristics)

### Open question: Multi-area awareness

The current design scopes the Curator to a single area per mutation. But knowledge sometimes spans areas — a fact in `stark-picking` may conflict with a fact in `networking`. Should the Curator have cross-area awareness? This adds complexity but may catch a class of conflicts the single-area design misses.

---

## Relationship to Other Proposals

This research builds on the analysis in [context-rendering-gap-ANALYSIS.md](context-rendering-gap-ANALYSIS.md), which identified two categories of improvement:

- **Category A (presentation):** Better rendering, grouping, relevance ranking — makes conflicts visible
- **Category B (structure):** Better knowledge authoring — eliminates conflicts

The Curator is a Category B solution that automates what the "Composite Entry Support" and "Knowledge Consolidation Workflow" proposals described manually. It replaces human discipline with systematic automation, treating knowledge quality as a continuous process rather than a periodic cleanup task.

The Category A improvements (type-grouped rendering, provenance-aware rendering) remain independently valuable — they improve the AI's ability to read knowledge regardless of curation quality. The Curator improves the quality of what's written; rendering improvements improve how it's read. Both matter.

---

## Next Steps

1. Write a design document for the Stage 1 detection pipeline (FTS5 similarity thresholds, tag overlap logic, staleness criteria)
2. Design the Curator prompt and test it against the existing stark-picking data as a dry run
3. Define the `curation_log.jsonl` and `curation_queue.jsonl` schemas
4. Implement Stage 1 as a post-add hook in the extension
5. Begin Phase 1 (observe mode) data collection
