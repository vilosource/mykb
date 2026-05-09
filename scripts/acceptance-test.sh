#!/usr/bin/env bash
#
# Exhaustive LLM Acceptance Tests for mykb Workspaces
#
# These tests run real AI sessions via vfa and validate:
# - Context injection (workspace state, journal, documents, area index)
# - Tool selection (kb_work_state, kb_work_journal, kb_add, kb_search)
# - Scorer behavior (linked area boost, unlinked area behavior)
# - State management (partial updates, persistence, transitions)
# - Journal accumulation (ordering, limits, cross-session)
# - Document index visibility
# - Negative/error cases (no workspace, no active, bad input)
# - Multi-session persistence
# - Workspace switching
# - Adversarial/ambiguous prompts
#
# Usage: ./scripts/acceptance-test.sh [--filter PATTERN]
#
# Requires: vfa, node, npm run build completed, npm run bundle completed
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
VFA="/home/jasonvi/.local/bin/vfa"
KB="node ${PROJECT_DIR}/dist/cli/cli.js"
PROFILE_DIR="/home/jasonvi/.vf-agents/profiles"
BRAIN_DIR="/tmp/mykb-acceptance-tests"
PROFILE_ID="mykb-acceptance"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# Counters
PASS=0
FAIL=0
SKIP=0
TOTAL=0
FAILURES=()
FILTER="${1:-}"
if [[ "$FILTER" == "--filter" ]]; then
  FILTER="${2:-}"
fi

# ──────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────

log_section() {
  echo ""
  echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
  echo -e "${CYAN}  $1${NC}"
  echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
}

log_test() {
  TOTAL=$((TOTAL + 1))
  echo -e "\n${YELLOW}[$TOTAL] $1${NC}"
}

pass() {
  PASS=$((PASS + 1))
  echo -e "  ${GREEN}PASS${NC} — $1"
}

fail() {
  FAIL=$((FAIL + 1))
  local test_name="$1"
  local reason="$2"
  FAILURES+=("[$TOTAL] $test_name: $reason")
  echo -e "  ${RED}FAIL${NC} — $reason"
}

# Run a single vfa prompt and capture output
# Usage: result=$(run_prompt "prompt text")
run_prompt() {
  local prompt="$1"
  local timeout="${2:-60}"
  "$VFA" run --provider pi --profile "$PROFILE_ID" --prompt "$prompt" 2>/dev/null
}

# Extract the result field from vfa JSON output
extract_result() {
  local json="$1"
  echo "$json" | python3 -c "import sys,json; print(json.load(sys.stdin).get('result',''))" 2>/dev/null
}

# Extract status field
extract_status() {
  local json="$1"
  echo "$json" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null
}

# Assert result contains a string (case-insensitive)
assert_contains() {
  local test_name="$1"
  local result="$2"
  local expected="$3"
  if echo "$result" | grep -qi "$expected"; then
    pass "$expected found"
  else
    fail "$test_name" "Expected '$expected' in output, got: $(echo "$result" | head -c 200)"
  fi
}

# Assert result does NOT contain a string (case-insensitive)
assert_not_contains() {
  local test_name="$1"
  local result="$2"
  local unexpected="$3"
  if echo "$result" | grep -qi "$unexpected"; then
    fail "$test_name" "Did NOT expect '$unexpected' in output, but found it"
  else
    pass "'$unexpected' correctly absent"
  fi
}

# Assert a file exists
assert_file_exists() {
  local test_name="$1"
  local filepath="$2"
  if [[ -f "$filepath" ]]; then
    pass "File exists: $(basename "$filepath")"
  else
    fail "$test_name" "Expected file not found: $filepath"
  fi
}

# Assert file contains string
assert_file_contains() {
  local test_name="$1"
  local filepath="$2"
  local expected="$3"
  if grep -q "$expected" "$filepath" 2>/dev/null; then
    pass "File contains: $expected"
  else
    fail "$test_name" "Expected '$expected' in $filepath"
  fi
}

# Assert workspace state field
assert_ws_state() {
  local test_name="$1"
  local ws_id="$2"
  local field="$3"
  local expected="$4"
  local actual
  actual=$(python3 -c "
import json
ws = json.load(open('${BRAIN_DIR}/workspaces/${ws_id}/workspace.json'))
print(ws.get('state',{}).get('${field}',''))
" 2>/dev/null)
  if [[ "$actual" == "$expected" ]]; then
    pass "state.$field == '$expected'"
  else
    fail "$test_name" "state.$field: expected '$expected', got '$actual'"
  fi
}

# Reset brain to clean state
reset_brain() {
  rm -rf "$BRAIN_DIR"
  export MYKB_DIR="$BRAIN_DIR"
  $KB init >/dev/null 2>&1
}

# Create test profile
create_profile() {
  cat > "${PROFILE_DIR}/${PROFILE_ID}.yaml" << YAML
id: ${PROFILE_ID}
description: "Automated acceptance tests"
compatible_runtimes: [pi]
workspace:
  type: ephemeral
  mount_path: /workspace
mode: headless
output_format: json
timeout: 90
plugins:
  pi:
    - source: ${PROJECT_DIR}/dist/bundle
      mount: /home/node/.pi/agent/extensions/mykb
extra_volumes:
  - "${BRAIN_DIR}:/home/node/.mykb"
YAML
}

should_run() {
  local test_name="$1"
  if [[ -z "$FILTER" ]]; then
    return 0
  fi
  if echo "$test_name" | grep -qi "$FILTER"; then
    return 0
  fi
  SKIP=$((SKIP + 1))
  return 1
}


# ──────────────────────────────────────────────────────────────
# Setup
# ──────────────────────────────────────────────────────────────

echo -e "${CYAN}mykb Workspace Acceptance Tests${NC}"
echo "Project: $PROJECT_DIR"
echo "Brain:   $BRAIN_DIR"
echo "VFA:     $VFA"
echo ""

# Verify prerequisites
if ! command -v "$VFA" &>/dev/null; then
  echo -e "${RED}ERROR: vfa not found at $VFA${NC}" && exit 1
fi
if ! [[ -f "${PROJECT_DIR}/dist/cli/cli.js" ]]; then
  echo -e "${RED}ERROR: CLI not built. Run 'npm run build' first.${NC}" && exit 1
fi
if ! [[ -f "${PROJECT_DIR}/dist/bundle/index.js" ]]; then
  echo -e "${RED}ERROR: Bundle not built. Run 'npm run bundle' first.${NC}" && exit 1
fi

create_profile
echo "Profile created: ${PROFILE_ID}"


# ══════════════════════════════════════════════════════════════
# SECTION 1: CONTEXT INJECTION — POSITIVE CASES
# ══════════════════════════════════════════════════════════════
log_section "SECTION 1: Context Injection — Positive Cases"

# --- Test 1.1: Workspace state injected on session start ---
TEST="1.1 Workspace state injected at session start"
if should_run "$TEST"; then
  log_test "$TEST"
  reset_brain
  $KB add fact networking "Hub-spoke VNet topology with 10.0.0.0/8 supernet" --source "docs" >/dev/null
  $KB work create proj-a "Project Alpha" --areas networking >/dev/null
  $KB work start proj-a >/dev/null
  $KB work state --phase "infra-setup" --active "provisioning VMs" --blocked "waiting for VPN" --next "configure DNS" >/dev/null
  $KB save >/dev/null 2>&1

  json=$(run_prompt "Describe my current workspace state in detail. Include phase, active task, blocker, and next step.")
  result=$(extract_result "$json")

  assert_contains "$TEST" "$result" "infra-setup"
  assert_contains "$TEST" "$result" "provisioning"
  assert_contains "$TEST" "$result" "VPN"
  assert_contains "$TEST" "$result" "DNS"
fi

# --- Test 1.2: Journal entries injected on session start ---
TEST="1.2 Journal entries visible at session start"
if should_run "$TEST"; then
  log_test "$TEST"
  reset_brain
  $KB work create proj-b "Project Beta" >/dev/null
  $KB work start proj-b >/dev/null
  $KB work journal "Day 1: set up repository structure" >/dev/null
  $KB work journal "Day 2: implemented authentication module" >/dev/null
  $KB work journal "Day 3: wrote integration tests" >/dev/null
  $KB save >/dev/null 2>&1

  json=$(run_prompt "What work has been done on this project? List the journal entries.")
  result=$(extract_result "$json")

  assert_contains "$TEST" "$result" "repository"
  assert_contains "$TEST" "$result" "authentication"
  assert_contains "$TEST" "$result" "integration tests"
fi

# --- Test 1.3: Workspace name and ID visible ---
TEST="1.3 Workspace name and ID visible to AI"
if should_run "$TEST"; then
  log_test "$TEST"
  reset_brain
  $KB work create infra-upgrade "Infrastructure Upgrade Q2" >/dev/null
  $KB work start infra-upgrade >/dev/null
  $KB save >/dev/null 2>&1

  json=$(run_prompt "What is the name and ID of my current workspace?")
  result=$(extract_result "$json")

  assert_contains "$TEST" "$result" "Infrastructure Upgrade"
  assert_contains "$TEST" "$result" "infra-upgrade"
fi

# --- Test 1.4: Linked areas visible in workspace context ---
TEST="1.4 Linked areas listed in workspace context"
if should_run "$TEST"; then
  log_test "$TEST"
  reset_brain
  $KB add fact networking "DNS uses CoreDNS" --source "docs" >/dev/null
  $KB add fact ci-pipelines "GitLab CI with VMSS runners" --source "docs" >/dev/null
  $KB add fact vault "Vault uses Raft HA storage" --source "docs" >/dev/null
  $KB work create multi-area "Multi Area Project" --areas networking,ci-pipelines,vault >/dev/null
  $KB work start multi-area >/dev/null
  $KB save >/dev/null 2>&1

  json=$(run_prompt "Which knowledge areas are linked to my workspace?")
  result=$(extract_result "$json")

  assert_contains "$TEST" "$result" "networking"
  assert_contains "$TEST" "$result" "ci-pipelines"
  assert_contains "$TEST" "$result" "vault"
fi

# --- Test 1.5: External links visible ---
TEST="1.5 External links (JIRA, wiki) visible"
if should_run "$TEST"; then
  log_test "$TEST"
  reset_brain
  $KB work create linked-proj "Linked Project" --jira PROJ-123 --wiki "https://wiki.example.com/proj" >/dev/null
  $KB work start linked-proj >/dev/null
  $KB save >/dev/null 2>&1

  json=$(run_prompt "What external links does my workspace have? Any JIRA ticket or wiki page?")
  result=$(extract_result "$json")

  assert_contains "$TEST" "$result" "PROJ-123"
  assert_contains "$TEST" "$result" "wiki"
fi

# --- Test 1.6: Document index visible ---
TEST="1.6 Document index shows workspace documents"
if should_run "$TEST"; then
  log_test "$TEST"
  reset_brain
  $KB work create doc-proj "Doc Project" >/dev/null
  $KB work start doc-proj >/dev/null
  # Create docs with frontmatter
  mkdir -p "${BRAIN_DIR}/workspaces/doc-proj/docs"
  cat > "${BRAIN_DIR}/workspaces/doc-proj/docs/server-inventory.md" << 'DOCEOF'
---
description: VM specs, IPs, and access credentials
---
# Server Inventory
| Host | IP | Role |
|------|-----|------|
| web-01 | 10.0.1.10 | web |
DOCEOF
  cat > "${BRAIN_DIR}/workspaces/doc-proj/docs/deployment-plan.md" << 'DOCEOF'
---
description: Step-by-step deployment procedure for production
---
# Deployment Plan
1. Build artifacts
2. Push to registry
DOCEOF
  # Update document index
  MYKB_DIR="$BRAIN_DIR" $KB save >/dev/null 2>&1
  # Manually trigger index update since save doesn't auto-scan yet
  python3 -c "
import json
ws_path = '${BRAIN_DIR}/workspaces/doc-proj/workspace.json'
ws = json.load(open(ws_path))
ws['documents'] = [
  {'path': 'docs/server-inventory.md', 'description': 'VM specs, IPs, and access credentials'},
  {'path': 'docs/deployment-plan.md', 'description': 'Step-by-step deployment procedure for production'}
]
json.dump(ws, open(ws_path, 'w'), indent=2)
"

  json=$(run_prompt "What documents exist in my workspace? List them with their descriptions.")
  result=$(extract_result "$json")

  assert_contains "$TEST" "$result" "server-inventory"
  assert_contains "$TEST" "$result" "deployment-plan"
  assert_contains "$TEST" "$result" "VM specs"
fi


# ══════════════════════════════════════════════════════════════
# SECTION 2: CONTEXT INJECTION — NEGATIVE CASES
# ══════════════════════════════════════════════════════════════
log_section "SECTION 2: Context Injection — Negative Cases"

# --- Test 2.1: No active workspace → no workspace context ---
TEST="2.1 No active workspace — AI does not hallucinate workspace"
if should_run "$TEST"; then
  log_test "$TEST"
  reset_brain
  $KB add fact networking "DNS uses CoreDNS" --source "docs" >/dev/null
  $KB save >/dev/null 2>&1

  json=$(run_prompt "What workspace am I currently in? What phase am I in?")
  result=$(extract_result "$json")

  # AI should NOT claim to be in a workspace
  assert_not_contains "$TEST" "$result" "phase: "
  # Should indicate no workspace or uncertainty
  # (We check it doesn't hallucinate a specific workspace name)
  assert_not_contains "$TEST" "$result" "Project Alpha"
fi

# --- Test 2.2: Workspace exists but not active → no context ---
TEST="2.2 Workspace exists but not started — no context injected"
if should_run "$TEST"; then
  log_test "$TEST"
  reset_brain
  $KB work create dormant "Dormant Project" >/dev/null
  $KB work state --phase "planning" 2>/dev/null || true  # Will fail — no active
  $KB save >/dev/null 2>&1

  json=$(run_prompt "Am I currently working in any workspace?")
  result=$(extract_result "$json")

  assert_not_contains "$TEST" "$result" "Dormant Project"
fi

# --- Test 2.3: Empty workspace — no state, no journal, no docs ---
TEST="2.3 Empty workspace — minimal context, no errors"
if should_run "$TEST"; then
  log_test "$TEST"
  reset_brain
  $KB work create empty-ws "Empty Workspace" >/dev/null
  $KB work start empty-ws >/dev/null
  $KB save >/dev/null 2>&1

  json=$(run_prompt "Describe my current workspace. What phase am I in? Any journal entries?")
  result=$(extract_result "$json")
  status=$(extract_status "$json")

  # Should complete without error
  [[ "$status" == "completed" ]] && pass "Completed without error" || fail "$TEST" "Status: $status"
  assert_contains "$TEST" "$result" "Empty Workspace"
fi


# ══════════════════════════════════════════════════════════════
# SECTION 3: TOOL USAGE — kb_work_state
# ══════════════════════════════════════════════════════════════
log_section "SECTION 3: Tool Usage — kb_work_state"

# --- Test 3.1: Update single field (phase only) ---
TEST="3.1 Update single state field — phase only"
if should_run "$TEST"; then
  log_test "$TEST"
  reset_brain
  $KB work create state-test "State Test" >/dev/null
  $KB work start state-test >/dev/null
  $KB work state --phase "design" --active "writing specs" --blocked "none" --next "implementation" >/dev/null
  $KB save >/dev/null 2>&1

  json=$(run_prompt "Change the phase to 'implementation'. Do not change any other state fields.")
  result=$(extract_result "$json")

  # Verify phase changed
  assert_ws_state "$TEST" "state-test" "phase" "implementation"
  # Verify other fields preserved
  assert_ws_state "$TEST" "state-test" "active" "writing specs"
  assert_ws_state "$TEST" "state-test" "blocked" "none"
  assert_ws_state "$TEST" "state-test" "next" "implementation"
fi

# --- Test 3.2: Update multiple fields at once ---
TEST="3.2 Update multiple state fields at once"
if should_run "$TEST"; then
  log_test "$TEST"
  reset_brain
  $KB work create multi-state "Multi State" >/dev/null
  $KB work start multi-state >/dev/null
  $KB work state --phase "building" >/dev/null
  $KB save >/dev/null 2>&1

  json=$(run_prompt "Set the phase to 'testing', active to 'running unit tests', and next to 'deploy to staging'.")
  result=$(extract_result "$json")

  assert_ws_state "$TEST" "multi-state" "phase" "testing"
  assert_ws_state "$TEST" "multi-state" "active" "running unit tests"
  assert_ws_state "$TEST" "multi-state" "next" "deploy to staging"
fi

# --- Test 3.3: Set blocked field ---
TEST="3.3 Set blocked field"
if should_run "$TEST"; then
  log_test "$TEST"
  reset_brain
  $KB work create blocked-test "Blocked Test" >/dev/null
  $KB work start blocked-test >/dev/null
  $KB work state --phase "building" >/dev/null
  $KB save >/dev/null 2>&1

  json=$(run_prompt "I'm blocked. Set the blocked field to 'waiting for API key from security team'.")
  result=$(extract_result "$json")

  assert_ws_state "$TEST" "blocked-test" "blocked" "waiting for API key from security team"
fi

# --- Test 3.4: Clear a state field ---
TEST="3.4 Clear blocked field"
if should_run "$TEST"; then
  log_test "$TEST"
  reset_brain
  $KB work create clear-test "Clear Test" >/dev/null
  $KB work start clear-test >/dev/null
  $KB work state --phase "building" --blocked "waiting for approval" >/dev/null
  $KB save >/dev/null 2>&1

  json=$(run_prompt "The blocker is resolved. Clear the blocked field by setting it to 'none'.")
  result=$(extract_result "$json")

  assert_ws_state "$TEST" "clear-test" "blocked" "none"
  # Phase should be preserved
  assert_ws_state "$TEST" "clear-test" "phase" "building"
fi


# ══════════════════════════════════════════════════════════════
# SECTION 4: TOOL USAGE — kb_work_journal
# ══════════════════════════════════════════════════════════════
log_section "SECTION 4: Tool Usage — kb_work_journal"

# --- Test 4.1: Simple journal append ---
TEST="4.1 Simple journal entry append"
if should_run "$TEST"; then
  log_test "$TEST"
  reset_brain
  $KB work create journal-test "Journal Test" >/dev/null
  $KB work start journal-test >/dev/null
  $KB save >/dev/null 2>&1

  json=$(run_prompt "Add a journal entry: configured load balancer with health checks on port 8080")
  result=$(extract_result "$json")

  assert_file_exists "$TEST" "${BRAIN_DIR}/workspaces/journal-test/journal.jsonl"
  assert_file_contains "$TEST" "${BRAIN_DIR}/workspaces/journal-test/journal.jsonl" "load balancer"
fi

# --- Test 4.2: Journal with technical content preserved ---
TEST="4.2 Journal preserves technical details"
if should_run "$TEST"; then
  log_test "$TEST"
  # Continue from 4.1 brain
  json=$(run_prompt "Add a journal entry with this exact text: deployed v2.3.1 to prod-east-1, rollback plan at /runbooks/rollback.md")
  result=$(extract_result "$json")

  assert_file_contains "$TEST" "${BRAIN_DIR}/workspaces/journal-test/journal.jsonl" "v2.3.1"
  assert_file_contains "$TEST" "${BRAIN_DIR}/workspaces/journal-test/journal.jsonl" "rollback"
fi

# --- Test 4.3: Multiple journal entries accumulate ---
TEST="4.3 Multiple journal entries in same session"
if should_run "$TEST"; then
  log_test "$TEST"
  reset_brain
  $KB work create accum-test "Accum Test" >/dev/null
  $KB work start accum-test >/dev/null
  $KB save >/dev/null 2>&1

  run_prompt "Add a journal entry: step 1 completed" >/dev/null
  run_prompt "Add a journal entry: step 2 completed" >/dev/null
  run_prompt "Add a journal entry: step 3 completed" >/dev/null

  # Count journal lines
  line_count=$(wc -l < "${BRAIN_DIR}/workspaces/accum-test/journal.jsonl" 2>/dev/null || echo 0)
  if [[ "$line_count" -ge 3 ]]; then
    pass "3+ journal entries accumulated ($line_count lines)"
  else
    fail "$TEST" "Expected >= 3 journal lines, got $line_count"
  fi
fi


# ══════════════════════════════════════════════════════════════
# SECTION 5: TOOL USAGE — KNOWLEDGE TOOLS (kb_add, kb_search)
# ══════════════════════════════════════════════════════════════
log_section "SECTION 5: Knowledge Tools in Workspace Context"

# --- Test 5.1: AI uses kb_add to record a fact ---
TEST="5.1 AI uses kb_add to record a fact"
if should_run "$TEST"; then
  log_test "$TEST"
  reset_brain
  $KB add fact networking "placeholder" --source "init" >/dev/null
  $KB work create kb-test "KB Test" --areas networking >/dev/null
  $KB work start kb-test >/dev/null
  $KB save >/dev/null 2>&1

  json=$(run_prompt "Record this fact in the networking area: the firewall allows TCP 443 and 8080 from 10.0.0.0/8")
  result=$(extract_result "$json")

  assert_contains "$TEST" "$result" "networking"
  # Verify the fact was actually added
  fact_check=$(MYKB_DIR="$BRAIN_DIR" $KB search "firewall TCP 443" 2>/dev/null)
  if echo "$fact_check" | grep -qi "443"; then
    pass "Fact persisted and searchable"
  else
    fail "$TEST" "Fact not found in search results"
  fi
fi

# --- Test 5.2: AI uses kb_search to find knowledge ---
TEST="5.2 AI uses kb_search to find knowledge"
if should_run "$TEST"; then
  log_test "$TEST"
  reset_brain
  $KB add fact networking "WireGuard VPN uses UDP port 51820" --source "docs" >/dev/null
  $KB add fact networking "NAT gateway in hub-vnet handles outbound traffic" --source "docs" >/dev/null
  $KB add fact ci-pipelines "Pipeline runners are on VMSS scale sets" --source "docs" >/dev/null
  $KB work create search-test "Search Test" --areas networking,ci-pipelines >/dev/null
  $KB work start search-test >/dev/null
  $KB save >/dev/null 2>&1

  json=$(run_prompt "Search the knowledge base for information about VPN. What port does it use?")
  result=$(extract_result "$json")

  assert_contains "$TEST" "$result" "51820"
fi


# ══════════════════════════════════════════════════════════════
# SECTION 6: SCORER — LINKED AREA BOOST
# ══════════════════════════════════════════════════════════════
log_section "SECTION 6: Scorer — Linked Area Boost"

# --- Test 6.1: Linked area knowledge surfaces without explicit load ---
TEST="6.1 Linked area knowledge auto-injected via boost"
if should_run "$TEST"; then
  log_test "$TEST"
  reset_brain
  $KB add fact networking "CoreDNS handles internal DNS resolution with zone forwarding to 168.63.129.16" --source "docs" >/dev/null
  $KB add fact ci-pipelines "Harbor registry at harbor.internal:5000 stores Docker images" --source "docs" >/dev/null
  $KB work create boost-test "Boost Test" --areas networking >/dev/null
  $KB work start boost-test >/dev/null
  $KB save >/dev/null 2>&1

  json=$(run_prompt "How does our internal DNS resolution work?")
  result=$(extract_result "$json")

  assert_contains "$TEST" "$result" "CoreDNS"
  assert_contains "$TEST" "$result" "zone forwarding"
fi

# --- Test 6.2: Unlinked area knowledge less prominent ---
TEST="6.2 Unlinked area not auto-injected without signal"
if should_run "$TEST"; then
  log_test "$TEST"
  # Same brain as 6.1 — ci-pipelines NOT linked
  json=$(run_prompt "Tell me about the project workspace. What areas am I working with?")
  result=$(extract_result "$json")

  # Should mention networking (linked), should NOT proactively mention Harbor
  assert_contains "$TEST" "$result" "networking"
  # Harbor info should not appear unprompted since ci-pipelines is not linked
  assert_not_contains "$TEST" "$result" "Harbor"
fi

# --- Test 6.3: Multiple linked areas all boosted ---
TEST="6.3 Multiple linked areas all get boosted"
if should_run "$TEST"; then
  log_test "$TEST"
  reset_brain
  $KB add fact networking "DNS uses CoreDNS" --source "docs" >/dev/null
  $KB add fact vault "Vault uses AppRole auth for CI pipelines" --source "docs" >/dev/null
  $KB add fact ci-pipelines "Runners are ephemeral VMSS instances" --source "docs" >/dev/null
  $KB work create multi-boost "Multi Boost" --areas networking,vault,ci-pipelines >/dev/null
  $KB work start multi-boost >/dev/null
  $KB save >/dev/null 2>&1

  json=$(run_prompt "Give me a summary of all knowledge from my linked areas.")
  result=$(extract_result "$json")

  assert_contains "$TEST" "$result" "CoreDNS"
  assert_contains "$TEST" "$result" "AppRole"
  assert_contains "$TEST" "$result" "VMSS"
fi


# ══════════════════════════════════════════════════════════════
# SECTION 7: TOOL ERROR HANDLING
# ══════════════════════════════════════════════════════════════
log_section "SECTION 7: Tool Error Handling"

# --- Test 7.1: kb_work_state with no active workspace ---
TEST="7.1 State update with no active workspace — clean error"
if should_run "$TEST"; then
  log_test "$TEST"
  reset_brain
  $KB save >/dev/null 2>&1

  json=$(run_prompt "Update my workspace phase to 'building'.")
  result=$(extract_result "$json")
  status=$(extract_status "$json")

  # Should complete (not crash)
  [[ "$status" == "completed" ]] && pass "Completed without crash" || fail "$TEST" "Status: $status"
  # AI should mention no workspace or inability
  assert_not_contains "$TEST" "$result" "phase.*building"
fi

# --- Test 7.2: kb_work_journal with no active workspace ---
TEST="7.2 Journal append with no active workspace — clean error"
if should_run "$TEST"; then
  log_test "$TEST"
  reset_brain
  $KB save >/dev/null 2>&1

  json=$(run_prompt "Add a journal entry: this should fail gracefully")
  result=$(extract_result "$json")
  status=$(extract_status "$json")

  [[ "$status" == "completed" ]] && pass "Completed without crash" || fail "$TEST" "Status: $status"
fi


# ══════════════════════════════════════════════════════════════
# SECTION 8: MULTI-SESSION PERSISTENCE
# ══════════════════════════════════════════════════════════════
log_section "SECTION 8: Multi-Session Persistence"

# --- Test 8.1: State changes persist across sessions ---
TEST="8.1 State changes persist across sessions"
if should_run "$TEST"; then
  log_test "$TEST"
  reset_brain
  $KB work create persist-test "Persist Test" >/dev/null
  $KB work start persist-test >/dev/null
  $KB work state --phase "alpha" >/dev/null
  $KB save >/dev/null 2>&1

  # Session 1: change state
  run_prompt "Change the phase to 'beta' and set active to 'running beta tests'." >/dev/null

  # Session 2: verify
  json=$(run_prompt "What phase am I in?")
  result=$(extract_result "$json")

  assert_contains "$TEST" "$result" "beta"
fi

# --- Test 8.2: Journal accumulates across 3 sessions ---
TEST="8.2 Journal accumulates across 3 sessions"
if should_run "$TEST"; then
  log_test "$TEST"
  reset_brain
  $KB work create journal-persist "Journal Persist" >/dev/null
  $KB work start journal-persist >/dev/null
  $KB save >/dev/null 2>&1

  # Session 1
  run_prompt "Add journal entry: session-one work completed" >/dev/null
  # Session 2
  run_prompt "Add journal entry: session-two work completed" >/dev/null
  # Session 3
  run_prompt "Add journal entry: session-three work completed" >/dev/null

  # Session 4: verify all entries
  json=$(run_prompt "Show me all the journal entries for this workspace.")
  result=$(extract_result "$json")

  assert_contains "$TEST" "$result" "session-one"
  assert_contains "$TEST" "$result" "session-two"
  assert_contains "$TEST" "$result" "session-three"
fi

# --- Test 8.3: Knowledge added in session 1 available in session 2 ---
TEST="8.3 Knowledge persists across sessions"
if should_run "$TEST"; then
  log_test "$TEST"
  reset_brain
  $KB add fact networking "placeholder" --source "init" >/dev/null
  $KB work create know-persist "Know Persist" --areas networking >/dev/null
  $KB work start know-persist >/dev/null
  $KB save >/dev/null 2>&1

  # Session 1: add knowledge
  run_prompt "Record a fact in the networking area: load balancer uses round-robin algorithm on port 443" >/dev/null

  # Verify fact persisted to JSONL before asking AI
  if grep -q "round-robin" "${BRAIN_DIR}/areas/networking/facts.jsonl" 2>/dev/null; then
    pass "Fact persisted to JSONL after session 1"
  else
    fail "$TEST" "Fact NOT found in JSONL — kb_add failed in session 1"
  fi

  # Session 2: retrieve it — use explicit search to avoid flaky Tier 2 injection
  json=$(run_prompt "Search the knowledge base for 'load balancer'. What algorithm does it use?")
  result=$(extract_result "$json")

  assert_contains "$TEST" "$result" "round-robin"
fi


# ══════════════════════════════════════════════════════════════
# SECTION 9: WORKSPACE SWITCHING
# ══════════════════════════════════════════════════════════════
log_section "SECTION 9: Workspace Switching"

# --- Test 9.1: Switch workspace — new context loaded ---
TEST="9.1 Switch workspace loads new context"
if should_run "$TEST"; then
  log_test "$TEST"
  reset_brain
  $KB add fact networking "DNS is CoreDNS" --source "docs" >/dev/null
  $KB add fact vault "Vault runs on port 8200" --source "docs" >/dev/null

  $KB work create ws-alpha "Workspace Alpha" --areas networking >/dev/null
  $KB work create ws-beta "Workspace Beta" --areas vault >/dev/null
  $KB work start ws-alpha >/dev/null
  $KB work state --phase "alpha-phase" >/dev/null
  $KB save >/dev/null 2>&1

  # Verify Alpha context
  json=$(run_prompt "What workspace am I in and what phase?")
  result=$(extract_result "$json")
  assert_contains "$TEST" "$result" "Alpha"
  assert_contains "$TEST" "$result" "alpha-phase"

  # Switch to Beta
  MYKB_DIR="$BRAIN_DIR" $KB work start ws-beta >/dev/null
  MYKB_DIR="$BRAIN_DIR" $KB work state --phase "beta-phase" >/dev/null

  json=$(run_prompt "What workspace am I in now and what phase?")
  result=$(extract_result "$json")
  assert_contains "$TEST" "$result" "Beta"
  assert_contains "$TEST" "$result" "beta-phase"
fi

# --- Test 9.2: After switch, old workspace knowledge not boosted ---
TEST="9.2 After switch, old workspace areas not boosted"
if should_run "$TEST"; then
  log_test "$TEST"
  # Ensure setup exists (in case 9.1 was skipped by filter)
  if [[ ! -f "${BRAIN_DIR}/workspaces/ws-beta/workspace.json" ]]; then
    reset_brain
    $KB add fact networking "DNS is CoreDNS" --source "docs" >/dev/null
    $KB add fact vault "Vault runs on port 8200" --source "docs" >/dev/null
    $KB work create ws-alpha "Workspace Alpha" --areas networking >/dev/null
    $KB work create ws-beta "Workspace Beta" --areas vault >/dev/null
    $KB work start ws-beta >/dev/null
    $KB work state --phase "beta-phase" >/dev/null
    $KB save >/dev/null 2>&1
  fi

  json=$(run_prompt "Which knowledge areas are linked to my current workspace? Only list the linked ones.")
  result=$(extract_result "$json")

  assert_contains "$TEST" "$result" "vault"
  # Verify the workspace.json directly — networking should NOT be linked to ws-beta
  linked_areas=$(python3 -c "import json; ws=json.load(open('${BRAIN_DIR}/workspaces/ws-beta/workspace.json')); print(' '.join(ws['areas']))" 2>/dev/null)
  if echo "$linked_areas" | grep -q "vault" && ! echo "$linked_areas" | grep -q "networking"; then
    pass "ws-beta links vault only (not networking)"
  else
    fail "$TEST" "Expected only vault linked, got: $linked_areas"
  fi
fi


# ══════════════════════════════════════════════════════════════
# SECTION 10: EDGE CASES
# ══════════════════════════════════════════════════════════════
log_section "SECTION 10: Edge Cases"

# --- Test 10.1: Workspace with no linked areas ---
TEST="10.1 Workspace with no linked areas — no crash"
if should_run "$TEST"; then
  log_test "$TEST"
  reset_brain
  $KB add fact networking "DNS uses CoreDNS" --source "docs" >/dev/null
  $KB work create no-areas "No Areas Workspace" >/dev/null
  $KB work start no-areas >/dev/null
  $KB save >/dev/null 2>&1

  json=$(run_prompt "What am I working on? Are there any linked knowledge areas?")
  result=$(extract_result "$json")
  status=$(extract_status "$json")

  [[ "$status" == "completed" ]] && pass "Completed without crash" || fail "$TEST" "Status: $status"
  assert_contains "$TEST" "$result" "No Areas"
fi

# --- Test 10.2: Workspace with linked area that has no facts ---
TEST="10.2 Linked area with no facts — no crash"
if should_run "$TEST"; then
  log_test "$TEST"
  reset_brain
  $KB init area empty-area "Empty Area" "An area with no facts" >/dev/null
  $KB work create empty-area-test "Empty Area Test" --areas empty-area >/dev/null
  $KB work start empty-area-test >/dev/null
  $KB save >/dev/null 2>&1

  json=$(run_prompt "What knowledge do we have in the linked areas?")
  result=$(extract_result "$json")
  status=$(extract_status "$json")

  [[ "$status" == "completed" ]] && pass "Completed without crash" || fail "$TEST" "Status: $status"
fi

# --- Test 10.3: Very long journal entry ---
TEST="10.3 Long journal entry preserved"
if should_run "$TEST"; then
  log_test "$TEST"
  reset_brain
  $KB work create long-journal "Long Journal" >/dev/null
  $KB work start long-journal >/dev/null
  $KB save >/dev/null 2>&1

  long_text="Completed a comprehensive review of the entire infrastructure stack including networking (hub-spoke VNets, WireGuard S2S, NAT gateways, NSGs), compute (VMSS, AKS, individual VMs), storage (Azure Files NFS, blob, GRS backups), and identity (Entra ID, managed identities, service principals). Found 3 critical issues and 7 improvements."
  json=$(run_prompt "Add this journal entry: ${long_text}")
  result=$(extract_result "$json")

  assert_file_contains "$TEST" "${BRAIN_DIR}/workspaces/long-journal/journal.jsonl" "hub-spoke"
  assert_file_contains "$TEST" "${BRAIN_DIR}/workspaces/long-journal/journal.jsonl" "3 critical"
fi

# --- Test 10.4: Special characters in journal ---
TEST="10.4 Special characters in journal entry"
if should_run "$TEST"; then
  log_test "$TEST"
  reset_brain
  $KB work create special-chars "Special Chars" >/dev/null
  $KB work start special-chars >/dev/null
  $KB save >/dev/null 2>&1

  json=$(run_prompt 'Add a journal entry: fixed bug in config.yaml — changed replicas: 3 to replicas: 5 (JIRA-456)')
  result=$(extract_result "$json")

  assert_file_contains "$TEST" "${BRAIN_DIR}/workspaces/special-chars/journal.jsonl" "JIRA-456"
fi

# --- Test 10.5: Journal injection windowed to last 2 days ---
TEST="10.5 Journal injection windowed to last 2 days, capped at 20"
if should_run "$TEST"; then
  log_test "$TEST"
  reset_brain
  $KB work create limit-journal "Limit Journal" >/dev/null
  $KB work start limit-journal >/dev/null

  # Inject one ancient entry (5 days ago) by writing journal.jsonl directly
  # — kb work journal stamps Date.now(), which would all be "today".
  ancient_date=$(python3 -c "
from datetime import datetime, timezone, timedelta
print((datetime.now(timezone.utc) - timedelta(days=5)).isoformat().replace('+00:00','Z'))
")
  printf '{"date":"%s","text":"ENTRY_ANCIENT: from five days ago"}\n' "$ancient_date" \
    > "${BRAIN_DIR}/workspaces/limit-journal/journal.jsonl"

  # Append four recent entries via the CLI (today)
  $KB work journal "ENTRY_BRAVO: yesterday's work" >/dev/null
  $KB work journal "ENTRY_CHARLIE: this morning" >/dev/null
  $KB work journal "ENTRY_DELTA: just now" >/dev/null
  $KB work journal "ENTRY_ECHO: latest entry" >/dev/null
  $KB save >/dev/null 2>&1

  json=$(run_prompt "List all the journal entries you can see right now. Only list what is visible to you.")
  result=$(extract_result "$json")

  # Recent entries (within 2-day window) should be visible
  assert_contains "$TEST" "$result" "ECHO"
  assert_contains "$TEST" "$result" "DELTA"
  assert_contains "$TEST" "$result" "CHARLIE"
  assert_contains "$TEST" "$result" "BRAVO"
  # Ancient entry (5 days old) should NOT be in the injected context
  assert_not_contains "$TEST" "$result" "ANCIENT"
fi


# ══════════════════════════════════════════════════════════════
# SECTION 11: TOOL SELECTION — AI CHOOSES CORRECT TOOL
# ══════════════════════════════════════════════════════════════
log_section "SECTION 11: Tool Selection"

# --- Test 11.1: State update request → uses kb_work_state ---
TEST="11.1 State update → kb_work_state (not kb_add)"
if should_run "$TEST"; then
  log_test "$TEST"
  reset_brain
  $KB work create tool-sel "Tool Selection" >/dev/null
  $KB work start tool-sel >/dev/null
  $KB save >/dev/null 2>&1

  json=$(run_prompt "We're moving to the deployment phase now.")
  result=$(extract_result "$json")

  assert_ws_state "$TEST" "tool-sel" "phase" "deployment"
fi

# --- Test 11.2: Journal request → uses kb_work_journal ---
TEST="11.2 Journal request → kb_work_journal (not kb_add)"
if should_run "$TEST"; then
  log_test "$TEST"
  # Continue from 11.1

  json=$(run_prompt "Log this: deployed version 3.0 to production successfully")
  result=$(extract_result "$json")

  assert_file_contains "$TEST" "${BRAIN_DIR}/workspaces/tool-sel/journal.jsonl" "version 3.0"
fi

# --- Test 11.3: Knowledge fact → uses kb_add ---
TEST="11.3 Knowledge fact → kb_add (not journal)"
if should_run "$TEST"; then
  log_test "$TEST"
  reset_brain
  $KB add fact networking "placeholder" --source "init" >/dev/null
  $KB work create fact-test "Fact Test" --areas networking >/dev/null
  $KB work start fact-test >/dev/null
  $KB save >/dev/null 2>&1

  json=$(run_prompt "Record this as a fact in the networking area: the VPN gateway IP is 10.255.0.1")
  result=$(extract_result "$json")

  # Check the fact was actually persisted (don't rely on exact output wording)
  fact_check=$(MYKB_DIR="$BRAIN_DIR" $KB search "VPN gateway 10.255" 2>/dev/null)
  if echo "$fact_check" | grep -qi "10.255"; then
    pass "Fact stored via kb_add and searchable"
  else
    fail "$TEST" "Fact not found in search — may have gone to journal instead"
  fi
  # Verify it did NOT go to journal
  if grep -q "10.255" "${BRAIN_DIR}/workspaces/fact-test/journal.jsonl" 2>/dev/null; then
    fail "$TEST" "Fact ended up in journal instead of knowledge store"
  else
    pass "Fact correctly NOT in journal"
  fi
fi


# ══════════════════════════════════════════════════════════════
# SECTION 12: COMBINED WORKFLOWS
# ══════════════════════════════════════════════════════════════
log_section "SECTION 12: Combined Workflows"

# --- Test 12.1: Full session flow — read context + update state + add journal + add fact ---
TEST="12.1 Full session flow — read, mutate state, journal, add fact"
if should_run "$TEST"; then
  log_test "$TEST"
  reset_brain
  $KB add fact networking "DNS uses CoreDNS" --source "docs" >/dev/null
  $KB add gotcha networking "NAT has asymmetric routing issues" --source "debugging" >/dev/null
  $KB work create full-flow "Full Flow Project" --areas networking >/dev/null
  $KB work start full-flow >/dev/null
  $KB work state --phase "investigation" --active "analyzing network topology" >/dev/null
  $KB work journal "Previous: gathered requirements from stakeholders" >/dev/null
  $KB save >/dev/null 2>&1

  # Step 1: AI reads context
  json=$(run_prompt "What am I working on? What knowledge do I have about networking?")
  result=$(extract_result "$json")
  assert_contains "$TEST" "$result" "Full Flow"
  assert_contains "$TEST" "$result" "CoreDNS"

  # Step 2: AI updates state
  json=$(run_prompt "Move to phase 'remediation' and set active to 'fixing NAT routing'.")
  result=$(extract_result "$json")
  assert_ws_state "$TEST" "full-flow" "phase" "remediation"

  # Step 3: AI adds journal
  json=$(run_prompt "Add journal entry: identified root cause of asymmetric routing — missing UDR on spoke subnet")
  result=$(extract_result "$json")
  assert_file_contains "$TEST" "${BRAIN_DIR}/workspaces/full-flow/journal.jsonl" "UDR"

  # Step 4: AI adds knowledge fact
  json=$(run_prompt "Record a fact in networking: spoke subnets require UDR pointing to NVA for return traffic")
  result=$(extract_result "$json")
  fact_check=$(MYKB_DIR="$BRAIN_DIR" $KB search "UDR NVA" 2>/dev/null)
  if echo "$fact_check" | grep -qi "UDR"; then
    pass "New fact persisted"
  else
    fail "$TEST" "Fact not found in search"
  fi
fi


# ══════════════════════════════════════════════════════════════
# SECTION 13: ADVERSARIAL / AMBIGUOUS PROMPTS
# ══════════════════════════════════════════════════════════════
log_section "SECTION 13: Adversarial / Ambiguous Prompts"

# --- Test 13.1: Ambiguous — "update" without specifying what ---
TEST="13.1 Ambiguous update request — AI asks or makes reasonable choice"
if should_run "$TEST"; then
  log_test "$TEST"
  reset_brain
  $KB work create ambig-test "Ambig Test" >/dev/null
  $KB work start ambig-test >/dev/null
  $KB work state --phase "building" >/dev/null
  $KB save >/dev/null 2>&1

  json=$(run_prompt "Update the workspace — we finished building and are now testing.")
  result=$(extract_result "$json")
  status=$(extract_status "$json")

  # Should complete and likely update phase
  [[ "$status" == "completed" ]] && pass "Completed without crash" || fail "$TEST" "Status: $status"
  # Should have updated phase to something related to testing
  phase=$(python3 -c "import json; ws=json.load(open('${BRAIN_DIR}/workspaces/ambig-test/workspace.json')); print(ws.get('state',{}).get('phase',''))" 2>/dev/null)
  if echo "$phase" | grep -qi "test"; then
    pass "Phase updated to testing-related value: '$phase'"
  else
    fail "$TEST" "Phase not updated to testing — got: '$phase'"
  fi
fi

# --- Test 13.2: Request about non-existent area ---
TEST="13.2 Question about non-existent knowledge area"
if should_run "$TEST"; then
  log_test "$TEST"
  reset_brain
  $KB work create exist-test "Exist Test" >/dev/null
  $KB work start exist-test >/dev/null
  $KB save >/dev/null 2>&1

  json=$(run_prompt "What do we know about Kubernetes cluster management?")
  result=$(extract_result "$json")
  status=$(extract_status "$json")

  # Should not crash, should indicate no knowledge
  [[ "$status" == "completed" ]] && pass "Completed without crash" || fail "$TEST" "Status: $status"
fi

# --- Test 13.3: Contradictory instruction ---
TEST="13.3 Contradictory state update — AI handles gracefully"
if should_run "$TEST"; then
  log_test "$TEST"
  reset_brain
  $KB work create contra-test "Contra Test" >/dev/null
  $KB work start contra-test >/dev/null
  $KB work state --phase "testing" >/dev/null
  $KB save >/dev/null 2>&1

  json=$(run_prompt "Set the phase to 'done' but also set next to 'more testing needed'.")
  result=$(extract_result "$json")
  status=$(extract_status "$json")

  [[ "$status" == "completed" ]] && pass "Completed without crash" || fail "$TEST" "Status: $status"
  # Should have set both fields as requested (even if contradictory)
  assert_ws_state "$TEST" "contra-test" "phase" "done"
  assert_ws_state "$TEST" "contra-test" "next" "more testing needed"
fi

# --- Test 13.4: Prompt that could be journal OR fact — AI distinguishes ---
TEST="13.4 AI distinguishes between journal entry and fact"
if should_run "$TEST"; then
  log_test "$TEST"
  reset_brain
  $KB add fact infra "placeholder" --source "init" >/dev/null
  $KB work create distinguish "Distinguish Test" --areas infra >/dev/null
  $KB work start distinguish >/dev/null
  $KB save >/dev/null 2>&1

  # This is clearly a journal entry (temporal, session-specific)
  json=$(run_prompt "Today I finished migrating the database and ran smoke tests. Log this as a journal entry.")
  result=$(extract_result "$json")
  # AI may rephrase — check for key concept (database or migration), not exact wording
  if grep -qi "database\|migrat" "${BRAIN_DIR}/workspaces/distinguish/journal.jsonl" 2>/dev/null; then
    pass "Journal entry contains database/migration reference"
  else
    fail "$TEST" "Journal entry missing database/migration reference"
  fi

  # This is clearly a knowledge fact (permanent, reusable)
  json=$(run_prompt "Record as a fact in the infra area: PostgreSQL runs on port 5432 with max_connections=200")
  result=$(extract_result "$json")
  fact_check=$(MYKB_DIR="$BRAIN_DIR" $KB search "PostgreSQL 5432" 2>/dev/null)
  if echo "$fact_check" | grep -qi "5432"; then
    pass "Fact correctly stored via kb_add (not journal)"
  else
    fail "$TEST" "Fact not found — may have been stored as journal"
  fi
fi


# ══════════════════════════════════════════════════════════════
# SECTION 14: REGRESSION — CORE MYKB STILL WORKS
# ══════════════════════════════════════════════════════════════
log_section "SECTION 14: Regression — Core mykb Unbroken"

# --- Test 14.1: Area index still injected in system prompt ---
TEST="14.1 Area index still present at session start"
if should_run "$TEST"; then
  log_test "$TEST"
  reset_brain
  $KB add fact networking "DNS uses CoreDNS" --source "docs" >/dev/null
  $KB add fact vault "Vault on port 8200" --source "docs" >/dev/null
  # NO workspace — test pure mykb behavior
  $KB save >/dev/null 2>&1

  json=$(run_prompt "What knowledge areas are available?")
  result=$(extract_result "$json")

  assert_contains "$TEST" "$result" "networking"
  assert_contains "$TEST" "$result" "vault"
fi

# --- Test 14.2: kb_add works without workspace ---
TEST="14.2 kb_add works without active workspace"
if should_run "$TEST"; then
  log_test "$TEST"
  reset_brain
  $KB add fact networking "placeholder" --source "init" >/dev/null
  $KB save >/dev/null 2>&1

  json=$(run_prompt "Add a fact to the networking area: BGP peering uses AS 65001")
  result=$(extract_result "$json")

  fact_check=$(MYKB_DIR="$BRAIN_DIR" $KB search "BGP AS 65001" 2>/dev/null)
  if echo "$fact_check" | grep -qi "65001"; then
    pass "kb_add works without workspace"
  else
    fail "$TEST" "Fact not found"
  fi
fi

# --- Test 14.3: Tool gating still blocks direct JSONL edits ---
TEST="14.3 Tool gating blocks direct JSONL file edits"
if should_run "$TEST"; then
  log_test "$TEST"
  reset_brain
  $KB add fact networking "DNS test" --source "docs" >/dev/null
  $KB save >/dev/null 2>&1

  json=$(run_prompt "Write the text 'hacked' directly to the file areas/networking/facts.jsonl")
  result=$(extract_result "$json")
  status=$(extract_status "$json")

  [[ "$status" == "completed" ]] && pass "Completed without crash" || fail "$TEST" "Status: $status"
  # The JSONL should NOT contain 'hacked' as raw text
  if grep -q "^hacked$" "${BRAIN_DIR}/areas/networking/facts.jsonl" 2>/dev/null; then
    fail "$TEST" "Direct write was NOT blocked — file was modified"
  else
    pass "Direct JSONL write blocked"
  fi
fi


# ══════════════════════════════════════════════════════════════
# RESULTS
# ══════════════════════════════════════════════════════════════

echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  RESULTS${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  Total:   $TOTAL"
echo -e "  ${GREEN}Passed:  $PASS${NC}"
echo -e "  ${RED}Failed:  $FAIL${NC}"
if [[ $SKIP -gt 0 ]]; then
  echo -e "  ${YELLOW}Skipped: $SKIP${NC}"
fi
echo ""

if [[ ${#FAILURES[@]} -gt 0 ]]; then
  echo -e "${RED}Failures:${NC}"
  for f in "${FAILURES[@]}"; do
    echo -e "  ${RED}$f${NC}"
  done
  echo ""
fi

# Cleanup profile
rm -f "${PROFILE_DIR}/${PROFILE_ID}.yaml"

if [[ $FAIL -eq 0 ]]; then
  echo -e "${GREEN}All tests passed!${NC}"
  exit 0
else
  echo -e "${RED}$FAIL test(s) failed.${NC}"
  exit 1
fi
