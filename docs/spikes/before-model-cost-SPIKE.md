# Spike: Gemini BeforeModel Hook Cost

## Question

Gemini's `BeforeModel` fires on every LLM API call. If we use it for knowledge injection (H6/H15 — scoring areas and injecting entries into the message array), what is the latency and throughput impact?

## Why it matters

`BeforeModel` is the most powerful injection point — it can modify what the model sees. But if it adds 50-100ms to every LLM call, it could significantly degrade the interactive experience. A typical conversation turn may have 1-5 LLM calls (planning, tool use, response generation), so overhead multiplies.

## What to measure

1. **Baseline latency** — Run a Gemini session without hooks, measure per-turn response time
2. **Empty hook latency** — Add a BeforeModel hook that reads stdin and exits 0 (measures hook invocation overhead)
3. **Scoring hook latency** — Add a BeforeModel hook that runs `kb match` against the prompt, measures the full scoring pipeline
4. **Injection hook latency** — Add a BeforeModel hook that scores + selects entries + modifies the message array, measures the full injection pipeline
5. **Frequency** — Count how many times BeforeModel fires per user turn (with and without tool use)

## Test setup

```bash
# Use vfa with Gemini provider and kb profile
# Create a hooks.json with incrementally complex BeforeModel hooks

# Step 1: Baseline (no hooks)
vfa run --provider gemini --profile kb --workdir ~/GitHub/mykb \
  --prompt "Explain the storage architecture"

# Step 2: Empty hook (measures invocation overhead)
# hooks.json: BeforeModel → "exit 0"

# Step 3: Scoring hook
# hooks.json: BeforeModel → "kb match <extracted prompt> --json > /dev/null; exit 0"

# Step 4: Full injection
# hooks.json: BeforeModel → script that scores, selects entries, modifies llm_request.messages
```

## Metrics to collect

| Metric | How | Target |
|--------|-----|--------|
| Hook invocation overhead | Empty hook vs no hook | <20ms |
| `kb match` latency | Time the scoring command | <50ms |
| Full injection pipeline | Score + select + JSON output | <100ms |
| BeforeModel fires per turn | Count in verbose mode | Expect 1-5 |
| Total per-turn overhead | fires × pipeline time | <200ms acceptable |

## Decision criteria

- **<100ms per hook invocation** → use BeforeModel for injection (H15)
- **100-200ms per invocation** → use BeforeModel selectively (only on first turn, or throttled)
- **>200ms per invocation** → fall back to BeforeAgent (per-prompt, not per-LLM-call) for nudge-only

## Running the spike

```bash
# Prerequisites
# - Gemini provider configured in vfa
# - kb profile with brain mounted
# - Gemini container image built

# Execute from vfa repo
cd ~/GitHub/vf-agents
vfa run --provider gemini --profile kb --workdir ~/GitHub/mykb \
  --prompt "Explain the storage architecture and key decisions"
```

## Expected outcome

A table of latency measurements that informs whether `BeforeModel` is viable for H15 (knowledge-aware model requests) or if we should limit Gemini's knowledge injection to `BeforeAgent` only.
