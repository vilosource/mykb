# SecondBrain Container Test Protocol

## What are SB containers?

SecondBrain (SB) containers are Docker images that package AI coding agent runtimes (Claude Code, Pi, Gemini CLI) with infrastructure tools (az, glab, terraform, ansible, vault, make, docker CLI) and the mykb knowledge base CLI. They are launched via `vfa` (vf-agents orchestrator) to run containerized agent sessions that have full access to the knowledge base and infrastructure tooling.

## Image hierarchy

```
node:20-bookworm-slim
  └── vf-agents-base              (git, curl, jq, ssh, node)
        └── vf-agents-sb           (+ python3, az, glab, terraform, ansible, vault, make, docker CLI, kb)
              ├── vf-agents-sb-claude   (+ Claude Code)
              ├── vf-agents-sb-pi       (+ Pi)
              └── vf-agents-sb-gemini   (+ Gemini CLI)
```

All SB images are built from `images/sb/` in the vf-agents repo (`~/GitHub/vf-agents`).

## How SB containers are launched

Shell functions in `~/.bashrc` launch containers via vfa:

```bash
kb-cclaude() {
  local sid=$(uuidgen)
  vfa run --provider kb-claude --profile kb --access full \
    --workdir "${1:-.}" --interactive \
    --env "KB_SESSION_ID=$sid" \
    --env "GITLAB_TOKEN=$GITLAB_TOKEN"
}
```

Key components:
- **Provider** (`~/.vf-agents/providers/kb-claude.yaml`) — selects runtime + SB image + auth
- **Profile** (`~/.vf-agents/profiles/kb.yaml`) — mounts volumes (brain, azure, glab, docker socket), sets instructions, configures lifecycle
- **Env vars** — `KB_SESSION_ID` for session isolation, `GITLAB_TOKEN` for GitLab API access

## Volume mounts

| Host path | Container path | Purpose | Mode |
|---|---|---|---|
| `~/.mykb` | `/home/node/.mykb` | Knowledge brain data | read-write |
| `~/.azure` | `/home/node/.azure` | Azure CLI auth state | read-write |
| `~/.config/glab-cli` | `/home/node/.config/glab-cli` | GitLab CLI config + tokens | read-only |
| `/var/run/docker.sock` | `/var/run/docker.sock` | Docker daemon access | read-write |

## Prerequisites for testing

Before running any tests, ensure:
1. SB images are built: `cd ~/GitHub/vf-agents/images && make build-sb`
2. Azure CLI is authenticated on the host: `az login`
3. GitLab token is valid: `glab auth status` (re-auth with `glab auth login` if expired)
4. `GITLAB_TOKEN` env var is set (typically in `~/.bashrc_private`)
5. Docker daemon is running: `docker info`
6. Brain data exists at `~/.mykb/` with at least one area

## Test levels

### Level 1: Automated E2E tests (CI-safe)

Location: `~/GitHub/vf-agents/tests/e2e/sb_images_test.go`

These tests verify tool presence and basic functionality without requiring host credentials. They run as part of the vf-agents E2E suite.

```bash
cd ~/GitHub/vf-agents
go test ./tests/e2e/... -tags=e2e -run TestSB -v -count=1
```

| Test | What it verifies |
|---|---|
| `TestSBBaseImageHasTools` | All 9 tools return expected version output (az, glab, terraform, vault, ansible, python3, make, docker, kb) |
| `TestSBClaudeImageHasRuntime` | Claude Code installed + infra tools inherited |
| `TestSBPiImageHasRuntime` | Pi installed + infra tools inherited |
| `TestSBGeminiImageHasRuntime` | Gemini CLI installed + infra tools inherited |
| `TestSBImageRunsAsNodeUser` | Container runs as `node` (UID 1000), not root |
| `TestSBKbCLIFunctional` | kb can init a brain, add facts, list areas, and search inside a container with a mounted brain volume |

### Level 2: Integration test with host mounts (manual)

This test verifies the full container environment matches the host. Run it manually after any change to Dockerfiles, profiles, or providers.

```bash
docker run --rm \
  -v ~/.mykb:/home/node/.mykb \
  -v ~/.azure:/home/node/.azure \
  -v ~/.config/glab-cli:/home/node/.config/glab-cli:ro \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -e GITLAB_TOKEN="$GITLAB_TOKEN" \
  -e KB_SESSION_ID="test-$(uuidgen)" \
  ghcr.io/vilosource/vf-agents-sb-claude:latest bash -c '
echo "=== VERSION CHECKS ==="
echo "1. kb: $(kb --version 2>&1)"
echo "2. az: $(az --version 2>&1 | grep azure-cli)"
echo "3. glab: $(glab version 2>&1 | head -1)"
echo "4. terraform: $(terraform version 2>&1 | head -1)"
echo "5. vault: $(vault version 2>&1)"
echo "6. ansible: $(ansible --version 2>&1 | head -1)"
echo "7. python3: $(python3 --version 2>&1)"
echo "8. make: $(make --version 2>&1 | head -1)"
echo "9. docker: $(docker --version 2>&1)"
echo "10. claude: $(claude --version 2>&1)"
echo "11. KB_SESSION_ID=$KB_SESSION_ID"
echo ""
echo "=== FUNCTIONAL TESTS ==="
echo "12. kb list:"
kb list 2>&1 | head -5
echo "13. kb search terraform:"
kb search "terraform" 2>&1 | head -3
echo "14. kb work list:"
kb work list 2>&1 | head -5
echo "15. az account show:"
az account show --query "{name:name, id:id}" -o table 2>&1
echo "16. glab auth:"
glab auth status 2>&1 | grep -E "Logged in|Token" | head -2
echo "17. terraform init:"
terraform -chdir=$(mktemp -d) init -backend=false 2>&1 | tail -1
echo "18. ansible ping:"
ansible localhost -m ping -o 2>&1
echo "19. python3:"
python3 -c "import json; print(json.dumps({\"test\": \"ok\"}))" 2>&1
echo "20. docker ps:"
docker ps --format "table {{.Names}}\t{{.Status}}" 2>&1 | head -3
'
```

**Expected result:** All 20 checks pass. Replace `vf-agents-sb-claude` with `vf-agents-sb-pi` or `vf-agents-sb-gemini` to test other runtimes (adjust check 10 accordingly).

### Level 3: Interactive session test (manual)

Launch a real session and paste the validation prompt:

```bash
kb-cclaude
```

Then paste this prompt inside the session:

```
Run these commands and report results in a table:

## Version checks
1. kb --version
2. az --version 2>&1 | grep azure-cli
3. glab version 2>&1 | head -1
4. terraform version 2>&1 | head -1
5. vault version
6. ansible --version 2>&1 | head -1
7. python3 --version
8. make --version | head -1
9. docker --version
10. echo "KB_SESSION_ID=$KB_SESSION_ID"

## Functional tests
11. kb list | head -5
12. kb search "terraform" | head -3
13. kb work list | head -5
14. az account show --query "{name:name, id:id}" -o table
15. glab auth status
16. terraform -chdir=$(mktemp -d) init -backend=false 2>&1 | tail -1
17. ansible localhost -m ping -o
18. python3 -c "import json; print(json.dumps({'test': 'ok'}))"
19. docker ps --format "table {{.Names}}\t{{.Status}}" | head -3
```

**Expected result:** 19/19 pass. This verifies the full vfa orchestration pipeline (provider selection, profile volumes, env var passthrough, session isolation).

## When to run each level

| Change | Level 1 | Level 2 | Level 3 |
|---|---|---|---|
| Dockerfile.base modified | Required | Required | Recommended |
| Runtime Dockerfile modified | Required | Required | — |
| kb profile changed | — | Required | Required |
| Provider config changed | — | — | Required |
| bashrc functions changed | — | — | Required |
| kb CLI updated (new cli.js bundle) | Required | Required | — |
| Volume mounts added/removed | — | Required | Required |

## Known gotchas

| Issue | Cause | Fix |
|---|---|---|
| `vault: Operation not permitted` | vault binary has mlock capability set | `setcap -r /usr/bin/vault` in Dockerfile |
| `az: command not found` (deb installer) | Azure CLI deb installer fails silently in Docker | Install via `pip3 install azure-cli` instead |
| `npm install` fails with E401 Nexus | package-lock.json contains private Nexus registry URLs | Remove lockfile, use `--registry=https://registry.npmjs.org` |
| `docker: permission denied` | node user not in docker group | `groupadd -g 1001 docker && usermod -aG docker node` in Dockerfile |
| `glab: 401 Unauthorized` | `GITLAB_TOKEN` env var not passed to container | Add `--env "GITLAB_TOKEN=$GITLAB_TOKEN"` to launch function |
| `npm install -g` creates broken symlinks | `npm install -g .` from `/tmp/` then `/tmp/` deleted | Install to `/opt/` persistent dir, symlink to `/usr/local/bin/` |

## File locations

| File | Purpose |
|---|---|
| `~/GitHub/vf-agents/images/sb/Dockerfile.base` | SB base image (all infra tools + kb) |
| `~/GitHub/vf-agents/images/sb/Dockerfile.claude` | SB Claude runtime layer |
| `~/GitHub/vf-agents/images/sb/Dockerfile.pi` | SB Pi runtime layer |
| `~/GitHub/vf-agents/images/sb/Dockerfile.gemini` | SB Gemini runtime layer |
| `~/GitHub/vf-agents/images/sb/kb-cli/` | Bundled mykb CLI (cli.js + package.json) |
| `~/GitHub/vf-agents/images/Makefile` | Build targets (`build-sb`, `build-sb-base`, etc.) |
| `~/GitHub/vf-agents/tests/e2e/sb_images_test.go` | Automated E2E tests |
| `~/.vf-agents/profiles/kb.yaml` | KB session profile (volumes, lifecycle) |
| `~/.vf-agents/providers/kb-claude.yaml` | Claude provider with SB image |
| `~/.vf-agents/providers/kb-pi.yaml` | Pi provider with SB image |
| `~/.vf-agents/instructions/kb/common.md` | Instructions injected into container sessions |
