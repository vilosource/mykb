# SecondBrain Container Operations Guide

## Overview

SecondBrain (SB) containers are Docker images that give AI coding agents (Claude Code, Pi, Gemini CLI) access to infrastructure tools and the mykb knowledge base. They allow running containerized agent sessions that can manage Azure resources, deploy via Terraform/Ansible, interact with GitLab, and maintain persistent knowledge — the same capabilities available on the host.

## Architecture

### Image hierarchy

```
node:20-bookworm-slim
  └── vf-agents-base                        (git, curl, jq, ssh, node)
        ├── vf-agents-claude                 (+ Claude Code)          ← generic images
        ├── vf-agents-pi                     (+ Pi)
        ├── vf-agents-gemini                 (+ Gemini CLI)
        └── vf-agents-sb                     (+ python3, az, glab, terraform,
              │                                 ansible, vault, make, docker CLI, kb)
              ├── vf-agents-sb-claude        (+ Claude Code)          ← SB images
              ├── vf-agents-sb-pi            (+ Pi)
              └── vf-agents-sb-gemini        (+ Gemini CLI)
```

Generic images are for general-purpose agent runs. SB images add the infrastructure toolset and kb CLI for SecondBrain work. The two tiers are independent — SB images don't affect generic images.

### How a session is launched

```
User runs kb-cclaude
        │
        ▼
~/.bashrc function
  - generates KB_SESSION_ID (UUID)
  - passes GITLAB_TOKEN if set
  - calls vfa run with provider + profile + access
        │
        ▼
vfa orchestrator
  - loads provider config → selects SB image + auth
  - loads profile → mounts volumes, sets instructions, lifecycle hooks
  - loads access config → mounts SSH keys, known_hosts, git identity
  - builds docker run command
        │
        ▼
Docker container
  - SB image with all tools baked in
  - brain mounted at /home/node/.mykb
  - SSH keys, Azure auth, glab config mounted
  - docker socket mounted
  - Claude Code / Pi / Gemini runs interactively
```

### Component roles

| Component | What it controls | Location |
|---|---|---|
| **Provider** | Which runtime image + auth method | `~/.vf-agents/providers/kb-claude.yaml` |
| **Profile** | Volume mounts, instructions, lifecycle hooks | `~/.vf-agents/profiles/kb.yaml` |
| **Access config** | SSH keys, git identity, env vars | `~/.vf-agents/access/full.yaml` |
| **Bashrc function** | Session ID generation, env var passthrough | `~/.bashrc` |
| **Dockerfile** | What tools are baked into the image | `~/GitHub/vf-agents/images/sb/` |
| **Instructions** | What the agent knows about kb commands | `~/.vf-agents/instructions/kb/common.md` |

## Configuration

### Provider configs

Providers bind a runtime to an SB image and auth method. KB sessions use dedicated providers separate from generic ones so the SB image doesn't affect non-KB work.

**`~/.vf-agents/providers/kb-claude.yaml`**
```yaml
id: kb-claude
runtime: claude-code
description: "Claude Code with SB toolset for kb sessions"
image: ghcr.io/vilosource/vf-agents-sb-claude:latest
auth:
  type: config-dir
  source: "/home/jasonvi/.claude"
tags: [kb, development]
```

**`~/.vf-agents/providers/kb-pi.yaml`**
```yaml
id: kb-pi
runtime: pi
description: "Pi agent with SB toolset for kb sessions"
image: ghcr.io/vilosource/vf-agents-sb-pi:latest
auth:
  type: config-dir
  source: "/home/jasonvi/.pi/agent"
llm_model: "zai/glm-4.7"
tags: [kb, development]
```

The `image` field on the provider overrides the runtime's default image. This is how SB images are selected — the profile does NOT set an image because the same profile is used across runtimes, and each runtime needs its own SB image (sb-claude, sb-pi, sb-gemini).

### Profile

The profile defines what gets mounted into the container and how the session lifecycle works.

**`~/.vf-agents/profiles/kb.yaml`**
```yaml
id: kb
description: "mykb knowledge base with infrastructure toolset (SB images)"
compatible_runtimes: [claude-code, pi, gemini-cli]
instructions:
  dir: /home/jasonvi/.vf-agents/instructions/kb

workdir:
  type: provided
  mount_path: /workdir
mode: headless
output_format: json
timeout: 120

volumes:
  - source: ~/.mykb
    target: /home/node/.mykb
  - source: ~/.azure
    target: /home/node/.azure
  - source: ~/.config/glab-cli
    target: /home/node/.config/glab-cli
    readonly: true
  - source: /var/run/docker.sock
    target: /var/run/docker.sock

lifecycle:
  post_run:
    - "kb save || true"
  resources:
    memory: "4g"
    cpus: "2.0"
```

Volume mounts:

| Host path | Container path | Purpose | Mode |
|---|---|---|---|
| `~/.mykb` | `/home/node/.mykb` | Knowledge brain (JSONL, SQLite, workspaces) | read-write |
| `~/.azure` | `/home/node/.azure` | Azure CLI auth state (persists `az login` across sessions) | read-write |
| `~/.config/glab-cli` | `/home/node/.config/glab-cli` | GitLab CLI host configs (which instances, protocols) | read-only |
| `/var/run/docker.sock` | `/var/run/docker.sock` | Docker daemon access for building/testing images | read-write |

SSH keys are NOT mounted via volumes — they're handled by the access config (see below).

### Access config

The access config manages SSH keys, git identity, and environment variables. It's referenced via `--access full` in the bashrc functions.

**`~/.vf-agents/access/full.yaml`**
```yaml
id: full
description: "Full access — GitHub + GitLab SSH keys, git identity"

ssh:
  keys:
    - host: github.com
      key: ~/.ssh/github
      user: git
    - host: gitlab.optiscangroup.com
      key: ~/.ssh/gitlab_ed25519
      user: git
    - host: "*.optiscangroup.com"
      key: ~/.ssh/ansible.priv
      user: ansible
  known_hosts: ~/.ssh/known_hosts

git:
  name: vilosource
  email: vilosource@users.noreply.github.com

env:
  TZ: "Europe/Helsinki"
```

vfa generates an SSH config file inside the container from these entries, mounts each key read-only, and copies known_hosts. The container's SSH config will contain:

```
Host github.com
  IdentityFile /home/node/.ssh/keys/github
  User git
  StrictHostKeyChecking accept-new

Host gitlab.optiscangroup.com
  IdentityFile /home/node/.ssh/keys/gitlab_ed25519
  User git
  StrictHostKeyChecking accept-new

Host *.optiscangroup.com
  IdentityFile /home/node/.ssh/keys/ansible.priv
  User ansible
  StrictHostKeyChecking accept-new
```

### Bashrc launch functions

**`~/.bashrc`**
```bash
kb-cclaude() {
  local sid env_args
  sid=$(uuidgen)
  env_args=(--env "KB_SESSION_ID=$sid")
  [ -n "$GITLAB_TOKEN" ] && env_args+=(--env "GITLAB_TOKEN=$GITLAB_TOKEN") \
    || echo "WARNING: GITLAB_TOKEN not set — glab will not authenticate in container"
  vfa run --provider kb-claude --profile kb --access full \
    --workdir "${1:-.}" --interactive \
    "${env_args[@]}"
}

kb-cpi() {
  local sid env_args
  sid=$(uuidgen)
  env_args=(--env "KB_SESSION_ID=$sid")
  [ -n "$GITLAB_TOKEN" ] && env_args+=(--env "GITLAB_TOKEN=$GITLAB_TOKEN") \
    || echo "WARNING: GITLAB_TOKEN not set — glab will not authenticate in container"
  vfa run --provider kb-pi --profile kb --access full \
    --workdir "${1:-.}" --interactive \
    "${env_args[@]}"
}
```

Key details:
- **`KB_SESSION_ID`** is generated fresh per session for workspace isolation across concurrent sessions.
- **`GITLAB_TOKEN`** is only passed when set. An empty `--env "GITLAB_TOKEN="` would override glab's config file tokens with nothing, causing 401 errors. The guard prevents this.
- **`--access full`** references the access config above for SSH keys and git identity.
- **`--workdir "${1:-.}"`** mounts the provided path or current directory as `/workdir`.
- `GITLAB_TOKEN` must be exported in the shell (typically set in `~/.bashrc_private`).

## Building images

```bash
cd ~/GitHub/vf-agents/images

# Build all SB images (base + 3 runtimes)
make build-sb

# Build individual images
make build-sb-base      # infra toolset + kb CLI
make build-sb-claude    # + Claude Code
make build-sb-pi        # + Pi
make build-sb-gemini    # + Gemini CLI

# Push to GHCR
make push-sb
```

### Updating the kb CLI bundle

When mykb is updated, the CLI bundle in the SB image must be refreshed:

```bash
# 1. Rebuild the CLI bundle in mykb
cd ~/GitHub/mykb
npm run bundle:cli

# 2. Copy the new bundle to vf-agents
cp dist/cli-bundle/cli.js ~/GitHub/vf-agents/images/sb/kb-cli/
cp dist/cli-bundle/package.json ~/GitHub/vf-agents/images/sb/kb-cli/

# 3. Rebuild SB images
cd ~/GitHub/vf-agents/images
make build-sb
```

Do NOT copy `package-lock.json` — it contains private Nexus registry URLs that cause E401 errors during Docker build. The Dockerfile uses `--registry=https://registry.npmjs.org` to install `better-sqlite3` from the public registry.

## Dockerfile details

**`images/sb/Dockerfile.base`** installs on top of `vf-agents-base`:

| Tool | Install method | Notes |
|---|---|---|
| python3, make | apt-get | Debian bookworm packages |
| Azure CLI | `pip3 install azure-cli` | Deb installer fails silently in Docker |
| terraform, vault | HashiCorp apt repo | Vault needs `setcap -r` to remove mlock capability |
| docker CLI | Docker apt repo | CLI only (`docker-ce-cli`), no daemon |
| glab | GitLab releases binary | Pinned version via `GLAB_VERSION` ARG |
| ansible | `pip3 install ansible` | Installed after python3 |
| kb | Bundled cli.js + better-sqlite3 | Installed to `/opt/kb-cli/`, symlinked to `/usr/local/bin/kb` |

The Dockerfile also:
- Creates docker group with GID 1001 and adds `node` user to it (matches host docker socket permissions)
- Runs as `USER node` (UID 1000, matching the host user)

Runtime Dockerfiles (`Dockerfile.claude`, `.pi`, `.gemini`) are thin — they just install the agent CLI on top of the SB base.

## Testing

### Prerequisites

1. SB images are built: `cd ~/GitHub/vf-agents/images && make build-sb`
2. Azure CLI is authenticated: `az login`
3. GitLab token is valid: `glab auth status`
4. `GITLAB_TOKEN` env var is set and exported
5. Docker daemon is running: `docker info`
6. Brain data exists at `~/.mykb/`
7. SSH keys exist: `~/.ssh/ansible.priv`, `~/.ssh/github`, `~/.ssh/gitlab_ed25519`

### Level 1: Automated E2E tests

Location: `~/GitHub/vf-agents/tests/e2e/sb_images_test.go`

No host credentials needed. Verifies tools are installed and kb works with a temp brain.

```bash
cd ~/GitHub/vf-agents
go test ./tests/e2e/... -tags=e2e -run TestSB -v -count=1
```

| Test | What it verifies |
|---|---|
| `TestSBBaseImageHasTools` | All 9 tools return expected version output |
| `TestSBClaudeImageHasRuntime` | Claude Code + infra tools present |
| `TestSBPiImageHasRuntime` | Pi + infra tools present |
| `TestSBGeminiImageHasRuntime` | Gemini CLI + infra tools present |
| `TestSBImageRunsAsNodeUser` | Container runs as `node` (UID 1000) |
| `TestSBKbCLIFunctional` | kb init, add, list, search with mounted brain |

### Level 2: Integration test with host mounts

Verifies tools work with real host credentials and data. Run after Dockerfile, profile, or volume changes.

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

**Expected:** All 20 pass. Replace image name to test other runtimes.

### Level 3: Interactive session test

Tests the full pipeline through vfa — provider selection, profile application, access config, env var passthrough, SSH keys.

```bash
kb-cclaude
```

Paste this prompt inside the session:

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
20. ssh -o ConnectTimeout=5 -o BatchMode=yes metrics-server-1.prod.optiscangroup.com hostname

A test PASSES if it produces meaningful output without errors. Report a summary line at the end: X/20 passed.
```

**Expected:** 20/20 pass.

### When to run each level

| Change | Level 1 | Level 2 | Level 3 |
|---|---|---|---|
| Dockerfile.base modified | Required | Required | Recommended |
| Runtime Dockerfile modified | Required | Required | — |
| kb profile changed | — | Required | Required |
| Provider config changed | — | — | Required |
| Access config changed | — | — | Required |
| bashrc functions changed | — | — | Required |
| kb CLI updated (new cli.js bundle) | Required | Required | — |
| Volume mounts added/removed | — | Required | Required |

## Known gotchas

| Issue | Cause | Fix |
|---|---|---|
| `vault: Operation not permitted` | Vault binary has mlock capability set | `setcap -r /usr/bin/vault` in Dockerfile |
| `az: command not found` in Docker | Azure CLI deb installer fails silently | Install via `pip3 install azure-cli` |
| `npm install` E401 Nexus error | package-lock.json has private registry URLs | Delete lockfile, use `--registry=https://registry.npmjs.org` |
| `docker: permission denied` | node user not in docker group (GID 1001) | `groupadd -g 1001 docker && usermod -aG docker node` |
| `glab: 401 Unauthorized` in container | Empty `GITLAB_TOKEN` overrides config file tokens | Only pass `--env` when variable is non-empty |
| `npm install -g` broken symlinks | `npm install -g .` from `/tmp/`, then `/tmp/` deleted | Install to `/opt/`, symlink to `/usr/local/bin/` |
| `kb: command not found` after install | npm linked to deleted temp dir | Use persistent `/opt/kb-cli/` not `/tmp/kb-cli/` |
| SSH `Host key verification failed` | SSH keys/known_hosts not mounted | Add keys to access config, not profile volumes |
| glab works on host but not container | `GITLAB_TOKEN` not set in the shell that ran `kb-cclaude` | Ensure `source ~/.bashrc` was run; check `env \| grep GITLAB` |

## File locations

| File | Purpose |
|---|---|
| **Images** | |
| `~/GitHub/vf-agents/images/sb/Dockerfile.base` | SB base image (all infra tools + kb) |
| `~/GitHub/vf-agents/images/sb/Dockerfile.claude` | SB Claude runtime layer |
| `~/GitHub/vf-agents/images/sb/Dockerfile.pi` | SB Pi runtime layer |
| `~/GitHub/vf-agents/images/sb/Dockerfile.gemini` | SB Gemini runtime layer |
| `~/GitHub/vf-agents/images/sb/kb-cli/` | Bundled mykb CLI (cli.js + package.json) |
| `~/GitHub/vf-agents/images/Makefile` | Build targets (`build-sb`, `push-sb`) |
| **Tests** | |
| `~/GitHub/vf-agents/tests/e2e/sb_images_test.go` | Automated E2E tests |
| **vfa configuration** | |
| `~/.vf-agents/profiles/kb.yaml` | KB session profile (volumes, instructions, lifecycle) |
| `~/.vf-agents/providers/kb-claude.yaml` | Claude provider → SB Claude image |
| `~/.vf-agents/providers/kb-pi.yaml` | Pi provider → SB Pi image |
| `~/.vf-agents/access/full.yaml` | SSH keys, git identity, env vars |
| `~/.vf-agents/instructions/kb/common.md` | Instructions injected into container sessions |
| **Host config** | |
| `~/.bashrc` | `kb-cclaude` and `kb-cpi` launch functions |
| `~/.bashrc_private` | `GITLAB_TOKEN` export |
| `~/.ssh/ansible.priv` | Infrastructure SSH key |
| `~/.ssh/github` | GitHub SSH key |
| `~/.ssh/gitlab_ed25519` | GitLab SSH key |
