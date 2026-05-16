# v2 Container Topology — Phase 6

> Status: design + reference artifacts. Phase 6 of
> `v2-privileged-write-channel-DESIGN.md` (issue #1).
>
> Scope boundary: this document + `deploy/mykbd.service` + the
> dual-socket daemon code are the **mykb-repo** side. The actual
> `vf-agents-pi` container wiring (the argo/product manifests that add the
> RO brain mount + the agent-socket bind-mount) lives in
> **`viloforge-platform`** (per the standing "vafi config in
> viloforge-platform" project fact) and is a *deployment* action, not
> mykb-repo code. The integration seam is specified in §4 so that change
> is mechanical.

## 1. The trust boundary, concretely

```
HOST (trusted)                          │ Pi CONTAINER (untrusted LLM)
                                        │
~/.mykb/  ── owned by brain uid ────────┼──  mounted READ-ONLY
   │                                    │      bash > facts.jsonl   → EROFS ✗
   │ (only writer)                      │      write tool           → EROFS ✗
   ▼                                    │      python -c 'open(w)'  → EROFS ✗
mykbd (systemd, brain uid)              │      MykbStore.append…    ──┐
   ├─ operator socket  0600  ───────────┼──  (NOT mounted in)         │
   │     host operator / kb CLI only    │                             │
   └─ agent socket     0666  ───────────┼──  bind-mounted in  ◄───────┘
         capability capped at 'agent'   │      the ONLY writable path
```

The brain is bind-mounted **read-only** into the container, so every
direct syscall path to a brain file returns `EROFS` — closing the
`bash-bypass-known-gap` (the acceptance criterion, Phase 7). The only
success path from inside the container is "speak L4 to the daemon over
the bind-mounted **agent** socket," which is validated and capability-
capped.

## 2. Capability without `SO_PEERCRED` (contract §2.2 amended)

Node has no public `SO_PEERCRED` API. Capability is therefore established
by **which socket** a connection arrives on, with the **kernel enforcing
who may `connect()`**:

| Socket | Mode | Reachable by | Capability |
|---|---|---|---|
| operator | `0600` | brain uid only (host operator, `kb` CLI) | `operator` — maintenance verbs, may assert `trust:'operator'` |
| agent | `0666` | anyone who can see the socket inode — i.e. only the container it is bind-mounted into | `agent` — mutation/read/workspace; asserted trust capped at `agent` |

`0666` on the agent socket is safe: **access is not privilege**. A
connection there can only ever obtain the `agent` capability; it cannot
call operator-only verbs nor forge `trust:'operator'` (dispatcher gate,
contract §5 / §3.1a). The socket is bind-mounted *only* into the trusted
Pi container, never exposed host-wide.

## 3. Host setup (reference)

1. Deploy the built daemon to `/opt/mykb` (`dist/`), Node ≥ the repo
   engine.
2. Install `deploy/mykbd.service` as `/etc/systemd/system/mykbd@.service`
   (templated on the brain user), adjust `MYKB_DIR` / paths.
3. `systemctl enable --now mykbd@<brainuser>`.
4. The agent socket is created in `RuntimeDirectory=/run/mykbd`
   (`/run/mykbd/agent.sock`); that directory is what the container mounts.

## 4. viloforge-platform integration seam (the cross-repo change)

The Pi product manifest (`viloforge-platform/argo/products/vafi*`) needs
exactly two volume edits on the agents-pi pod/container:

1. **Brain, read-only**:
   `~/.mykb` (host) → container brain path, `readOnly: true`.
2. **Agent socket, read-write** (a socket endpoint, not a brain file):
   host `/run/mykbd/agent.sock` (or its dir) → the in-container path the
   extension expects, and set `MYKB_SOCKET` (or `MYKB_STORE=rpc` +
   `MYKB_SOCKET`) so `selectKnowledgeStore` (Phase 4/5) picks the RPC
   store. No brain write mount.

Nothing else in the container changes: the extension and `kb` CLI already
auto-select the RPC store when the socket is present (Phases 4–5). When
that platform change lands, Phase 7's `bash-bypass-known-gap` flips
🐛→✅ in `experiments/tool-gating/EXPERIMENT.md`.

## 5. What is NOT in scope here

- The argo/manifest change itself (lands in viloforge-platform; §4 is the
  spec for it).
- Host-mode `kb-pi` enforcement — explicitly out of v2 scope (parent
  DESIGN §Scope); the host operator is trusted and uses the operator
  socket / local store.
- Multi-host / cloud backends (parent DESIGN §Backend extensibility) —
  the L2 Strategy seam exists; no second backend is built in v2.
