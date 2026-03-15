# LLM Acceptance Testing Guide

## Purpose

Unit tests verify the code works. LLM acceptance tests verify the **AI experience** works. mykb's user is an AI — we need to test that the AI actually uses the knowledge, follows redirects, and answers from injected context.

## Prerequisites

- `vfa` CLI installed (`~/.local/bin/vfa`)
- Pi provider configured (`vfa providers` shows `pi`)
- mykb extension built (`cd ~/GitHub/mykb && npm run build`)
- `mykb-dev` vfa profile created (see below)

## Setup

### 1. Create the mykb-dev vfa profile

```bash
cat > ~/.vf-agents/profiles/mykb-dev.yaml << 'EOF'
id: mykb-dev
description: "Profile for testing mykb Pi extension"
compatible_runtimes: [pi]
workspace:
  type: ephemeral
  mount_path: /workspace
mode: headless
output_format: json
timeout: 60
plugins:
  pi:
    - source: /home/jasonvi/GitHub/mykb/dist/extension
      mount: /home/node/.pi/agent/extensions/mykb
    - source: /tmp/mykb-acceptance-brain
      mount: /home/node/.mykb
EOF
```

### 2. Seed the test brain

```bash
export MYKB_DIR=/tmp/mykb-acceptance-brain
rm -rf $MYKB_DIR

# Build CLI first
cd ~/GitHub/mykb && npm run build

# Initialize brain
node dist/cli/cli.js init

# Add networking knowledge
node dist/cli/cli.js add fact networking "DNS uses CoreDNS with zone forwarding to 10.0.0.2" --source "docs"
node dist/cli/cli.js add fact networking "Load balancer health checks on /healthz every 10 seconds" --source "monitoring"
node dist/cli/cli.js add gotcha networking "NAT gateway has asymmetric routing — inbound and outbound use different IPs" --source "debugging"
node dist/cli/cli.js add decision networking "Use CoreDNS over BIND" --why "Kubernetes native, simpler config" --rejected "BIND — too complex for our scale"

# Add CI knowledge
node dist/cli/cli.js add fact ci-pipelines "CI runners use autoscaling VM pools with spot instances" --source "cloud-console"
node dist/cli/cli.js add fact ci-pipelines "Pipeline timeout set to 30 minutes for build jobs" --source "config"
node dist/cli/cli.js add gotcha ci-pipelines "npm lockfile bakes in registry URL from ~/.npmrc at install time" --source "debugging"

# Add secrets knowledge
node dist/cli/cli.js add fact secrets "Vault uses auto-unseal with cloud KMS" --source "vault-docs"
node dist/cli/cli.js add fact secrets "API keys rotated every 90 days via automated job" --source "runbook"

# Save (git commit)
node dist/cli/cli.js save

unset MYKB_DIR
```

### 3. Build the extension

```bash
cd ~/GitHub/mykb && npm run build
```

## Test Execution

Run each test with `vfa run` and verify the `result` field in the JSON output.

### Phase 7: Tools

**Test 7.1 — AI uses kb_add when asked to save knowledge**
```bash
vfa run --provider pi --profile mykb-dev \
  --prompt "Remember that our API gateway runs on port 8443. Save this to the api-gateway area."
```
Expected: AI uses `kb_add` tool, result mentions fact was saved.

**Test 7.2 — AI uses kb_search to find knowledge**
```bash
vfa run --provider pi --profile mykb-dev \
  --prompt "Do we have any knowledge about DNS?"
```
Expected: AI uses `kb_search`, result mentions CoreDNS.

**Test 7.3 — AI uses kb_list to discover areas**
```bash
vfa run --provider pi --profile mykb-dev \
  --prompt "What knowledge areas do we have?"
```
Expected: AI uses `kb_list`, result lists networking, ci-pipelines, secrets.

**Test 7.4 — AI picks kb_load for full area request**
```bash
vfa run --provider pi --profile mykb-dev \
  --prompt "Load everything we know about networking"
```
Expected: AI uses `kb_load` (not `kb_search`), returns full area with facts, gotchas, decisions.

### Phase 8: Three-Tier Delivery

**Test 8.1 — Tier 1: AI knows what areas exist**
```bash
vfa run --provider pi --profile mykb-dev \
  --prompt "What knowledge domains are available? Just list them."
```
Expected: AI lists networking, ci-pipelines, secrets (from system prompt index, without using any tools).

**Test 8.2 — Tier 2: AI answers from auto-injected context**
```bash
vfa run --provider pi --profile mykb-dev \
  --prompt "What DNS setup do we use?"
```
Expected: AI answers "CoreDNS with zone forwarding" WITHOUT being told to load an area and WITHOUT using kb_load or kb_search.

**Test 8.3 — Tier 2: AI uses gotchas from context**
```bash
vfa run --provider pi --profile mykb-dev \
  --prompt "Are there any known issues with our NAT configuration?"
```
Expected: AI mentions asymmetric routing.

**Test 8.4 — Tier 2 doesn't inject irrelevant knowledge**
```bash
vfa run --provider pi --profile mykb-dev \
  --prompt "What is 2 + 2?"
```
Expected: AI answers 4. Does NOT mention DNS, runners, or Vault.

**Test 8.5 — Tier 3: /kb command loads full area**
```bash
vfa session start --provider pi --profile mykb-dev --prompt "/kb networking"
vfa session send --prompt "Tell me everything you know about our networking setup"
vfa session close
```
Expected: AI has comprehensive networking knowledge — DNS, load balancer, NAT gotcha, CoreDNS decision.

### Phase 9: Tool Gating

**Test 9.1 — Write to .jsonl is blocked**
```bash
vfa run --provider pi --profile mykb-dev \
  --prompt "Write the text 'hello' to a file called test.jsonl"
```
Expected: AI reports the write was blocked, mentions using kb_add instead.

**Test 9.2 — Normal file writes are allowed**
```bash
vfa run --provider pi --profile mykb-dev \
  --prompt "Create a file called notes.txt with the text 'hello world'"
```
Expected: AI creates the file successfully (not blocked).

## Results Template

| Test | Prompt | Expected | Actual | Pass/Fail |
|------|--------|----------|--------|-----------|
| 7.1 | Save knowledge | Uses kb_add | | |
| 7.2 | Find DNS knowledge | Uses kb_search, mentions CoreDNS | | |
| 7.3 | List areas | Uses kb_list, shows 3 areas | | |
| 7.4 | Load full area | Uses kb_load, full networking | | |
| 8.1 | List domains | Lists areas from Tier 1 index | | |
| 8.2 | DNS setup | Answers CoreDNS without tools | | |
| 8.3 | NAT issues | Mentions asymmetric routing | | |
| 8.4 | Irrelevant prompt | Answers 4, no knowledge injected | | |
| 8.5 | /kb command | Comprehensive networking knowledge | | |
| 9.1 | Write .jsonl | Blocked, redirected to kb_add | | |
| 9.2 | Write .txt | Allowed, file created | | |

## Notes

- Tests 8.2 and 8.3 are the most important — they validate the core value proposition (auto-injected knowledge without explicit loading)
- Test 8.4 validates that the scorer doesn't inject everything — relevance filtering works
- If a test fails, the issue is likely in tool descriptions (7.x), scorer/rendering (8.x), or gating rules (9.x) — not in the core library (which has 234 unit tests)
- Run `vfa logs <run_id>` to see raw Pi output for debugging
- Check container stderr for extension errors: `cat ~/.vf-agents/runs/<run_id>/raw_stderr.txt`
