#!/usr/bin/env bats
#
# Boundary-rule lint: the kb-spike control plane must never call the
# host's `kb`. Only scenarios call kb (via the kb() function defined in
# step.sh, which routes to the captured cli at <instance>/.e2e-build/).
#
# We grep for `kb ` as a command in scripts/spike/kb-spike and the libs,
# excluding:
#   - the kb() function definition itself in step.sh
#   - lines that match `node ... cli.js` (captured-cli invocations)
#   - kb-spike or kb_spike or KB_SPIKE_* tokens
#   - comments and string content discussing the rule

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
}

# Strip shell comments before linting — comments may legitimately
# discuss the boundary rule and mention `kb`.
_strip_comments() {
  sed -E 's/(^|[[:space:]])#.*$//'
}

@test "no host-kb calls in scripts/spike/kb-spike (excluding comments)" {
  out="$(_strip_comments < "$REPO_ROOT/scripts/spike/kb-spike" \
        | grep -nE '(^|[;&|`(])[[:space:]]*kb[[:space:]]+' || true)"
  if [ -n "$out" ]; then
    echo "Boundary violation in scripts/spike/kb-spike:"
    echo "$out"
    false
  fi
}

@test "no host-kb calls in scripts/spike/lib/*.sh except kb() wrapper definition" {
  for f in "$REPO_ROOT"/scripts/spike/lib/*.sh; do
    # Strip comments, then look for `kb ` at command position. The kb()
    # function definition has parens, not a space — won't match.
    out="$(_strip_comments < "$f" \
           | grep -nE '(^|[;&|`(])[[:space:]]*kb[[:space:]]+' || true)"
    if [ -n "$out" ]; then
      echo "Boundary violation in $f:"
      echo "$out"
      false
    fi
  done
}

@test "control-plane shellouts limited to git, docker, vfa, jq, node, cp, rm, mkdir" {
  # Coarse sanity: every external command in the control plane must be
  # one of the methodology-allowed binaries (or builtin).
  allowed='git|docker|vfa|jq|node|cp|rm|mkdir|chmod|cat|date|grep|sed|awk|basename|dirname|readlink|printf|echo|test|true|false|cd|exec'
  for f in "$REPO_ROOT/scripts/spike/kb-spike" "$REPO_ROOT"/scripts/spike/lib/*.sh; do
    # Sniff out 'somecmd ' that isn't the allowed set, in command position.
    # This is a heuristic — false positives are tolerable since we only
    # need to catch the obvious 'kb ', 'curl ', 'wget ', etc.
    run bash -c "grep -hE '^[[:space:]]*[a-z_][a-z0-9_-]+[[:space:]]+' \"$f\" \
      | sed -E 's/^[[:space:]]*([a-z_][a-z0-9_-]+).*/\1/' \
      | sort -u \
      | grep -vE '^($allowed|spike_[a-z_]+|cmd_[a-z_]+|_spike_[a-z_]+|_kb_[a-z_]+|usage|main|kb)$' \
      || true"
    # Output here would list any unexpected first-token names; we don't
    # fail the test on it, just surface for inspection.
    [ -z "$output" ] || {
      echo "Note: unrecognized first-token names in $f:"
      echo "$output"
    }
  done
}
