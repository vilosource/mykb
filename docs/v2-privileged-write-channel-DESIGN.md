# v2 Privileged Write Channel — Design

> Status: design — captures the architectural commitment to close the tool-gating bash-bypass gap (GitHub issue [#1](https://github.com/vilosource/mykb/issues/1)) and the layered architecture decided in session 2026-05-14.
>
> Companions: `v2-harness-memory-RESEARCH.md` (write boundaries / OWASP MCP Top 10), `experiments/tool-gating/EXPERIMENT.md` (regression home for `bash-bypass-known-gap`).
>
> Relationship to the v2 roadmap (`v2-roadmap-PLAN.md`): this is a **separate** v2 architectural commitment from the 10 §16 commitments. The §16 list is about content quality, retrieval, and curation; this one is about the trust boundary that protects writes regardless of content. They are independent and can ship in parallel.

## Problem

`src/extension/hooks/tool-gating.ts` (`createToolGatingHandler`) blocks `write` and `edit` *tool names* from touching knowledge files. The Pi runtime also exposes `bash`, so `bash 'echo "..." > areas/<id>/facts.jsonl'` walks straight past the gate.

Empirically observed on 2026-05-10 (logged as gotcha `K1yQnjNV`, scenario `bash-bypass-known-gap` in `experiments/tool-gating/EXPERIMENT.md`):

1. LLM called `write` against `…/facts.jsonl` → hook blocked correctly; LLM received the reason text.
2. LLM's thinking transcript: *"The write tool is blocked for knowledge files — I need to use the kb_* tools instead. However, the user explicitly asked me to test file editing. Let me try the bash command to write the file directly using echo or a similar method."*
3. LLM called `bash 'echo "..." > .../facts.jsonl'`. Successful. **Brain file overwritten.**

Blast radius: corrupted JSONL invariants (id uniqueness, schema, tombstones, FTS sync drift).

The wrinkle that makes the fix non-trivial: the kb extension runs **in-process** with the Pi agent, so `kb_add` is `fs.appendFileSync` as the **same OS user** as the LLM's `bash`. Any defense below the application layer (read-only mount, ACLs) also blocks `kb_add` — unless the extension's writes are re-routed through a privileged channel.

The 2026-05-11 triage decision (kb decision `Iw3j51Sr`, GitHub issue [#1](https://github.com/vilosource/mykb/issues/1)) tagged this as a **v2 design item**: treat the in-process hook as a guardrail for the cooperative-LLM case; build the privileged channel properly rather than patch the hook.

## Threat model

| Threat | In scope | Out of scope |
|---|---|---|
| LLM bypasses `kb_add` via `bash` IO redirection (`>`, `>>`, `tee`, `sed -i`, `dd`, `python -c 'open(..., "w")'`, heredocs, `sh -c` nesting) | ✅ | |
| LLM corrupts JSONL invariants via a permitted tool whose intent is "write text somewhere" | ✅ | |
| LLM lies to `kb_add` (calls it with wrong content) | | ✅ — that's a content-quality problem, not a write-channel problem; addressed by curator/trust-gate work in the §16 commitments |
| Operator (`kb-pi`, direct `kb` CLI on host) corrupts brain | | ✅ — operator owns the brain; `rm -rf ~/.mykb` is always available; trusted role |
| Brain-on-host disk corruption, ransomware, etc. | | ✅ — covered by git history of `~/.mykb` + standard backups |
| Multi-tenant: two LLMs racing on the same brain | | Out for v2; revisit if mykb ever serves multi-user |

The threat we are closing: **an LLM running in a containerized Pi runtime, with the kb extension loaded, attempts to mutate brain files through any syscall path that is not the kb extension's own validated API.**

## Background — current write surface

All brain mutations today go through one of these call sites:

| File | Function(s) | What it writes |
|---|---|---|
| `src/core/store.ts` | `appendEntry`, `tombstone`, `compact` | `*.jsonl` (facts, decisions, gotchas, patterns, links) |
| `src/core/area.ts` | `createArea`, `updateAreaMetadata` | `area.json` |
| `src/core/manifest.ts` | `regenerateManifest` | `manifest.json` |
| `src/core/init.ts` | `initBrain` | `manifest.json`, `.gitignore` |
| `src/core/workspace.ts` | `createWorkspace`, `journal`, `addNote`, `archiveWorkspace`, `setActive`, `addArtifact`, etc. | workspace files, `journal.jsonl`, `notes.jsonl`, `artifacts.jsonl`, `.active`, continuity files |
| `src/extension/state.ts` | `persist` | extension state snapshot |

Both the `kb` CLI **and** the Pi extension's `MykbStore` call into these functions directly. Two clients, shared core, in-process.

## Decision — host-side daemon over Unix socket

Chosen over the alternatives that follow.

The daemon process runs on the host (outside the Pi container), owns `~/.mykb/` on disk, and is the only entity with write capability to brain files. Clients (Pi extension, `kb` CLI) speak to it over a Unix socket.

Inside the Pi container: `~/.mykb/` is bind-mounted **read-only**. The daemon's Unix socket is bind-mounted in (writable as a socket endpoint — sockets are not "file writes" in the EROFS sense; they are connection endpoints whose I/O is mediated by the kernel against the daemon process, not against the mounted filesystem). Every syscall path from inside the container that targets a brain file — `bash >`, `write` tool, `python -c 'open'`, even the extension's own `fs.appendFileSync` if anyone reintroduced it — returns `EROFS`. The only path that succeeds is "talk to the daemon over the socket."

### Alternatives considered

**(B) Generalize the captured-`kb`-CLI pattern.** The kb-spike harness already crosses container→host by capturing the `kb` CLI. Reusing that mechanism for production writes (extension shells out / RPCs into a thin shim that shells out to `kb add fact …` etc.) is conceptually simpler — no new long-lived process, reuses a battle-tested binary, one trust boundary instead of two. **Rejected** because:

- Per-write process spawn (~tens of ms) is fine for interactive use but a real cost on bulk-import paths (OSB migration) and future batched curator passes.
- Schema validation, id uniqueness, FTS sync would still need to live somewhere; they currently live in `src/core/*` which the CLI invokes. The CLI-as-channel inherits all the same business logic but pays the process-spawn cost on every mutation.
- Future backends (S3, NFS, queue — see "Backend extensibility" below) need a persistent connection model. A spawn-per-call model would have to be redesigned at that point. The daemon design pays the cost up front.
- No protocol-level affordance for streaming/batched operations or for backpressure.

**(C) Extend the in-process hook to also intercept `bash`.** Parse the command for IO redirection to knowledge paths. **Rejected** in the 2026-05-11 triage. Shell parsing is hard (`tee`, `sed -i`, `dd`, `cp`/`mv`, `python -c`, heredocs, `sh -c` nesting, `eval`); false sense of completeness; enforcement at the same layer as the attack.

**(D) Filesystem ACLs / setfacl.** Collapses into the daemon design because some process still needs write capability — that process becomes the daemon. ACLs are an alternative *enforcement mechanism* to the RO bind-mount, considered in "Scope" below.

## Topology

```
container (Pi runtime + kb extension; brain mounted RO):

   bash → echo > facts.jsonl  →  EROFS ✗
   write tool → facts.jsonl   →  EROFS ✗
   python -c 'open(...)'      →  EROFS ✗
   MykbStore.appendFact()     →  RPC over socket ─────────┐
                                                          │
                                  socket bind-mount       │
                                  (writable as a socket)  │
                                                          ▼
host (mykbd daemon, owns ~/.mykb on disk):

   daemon receives append-fact request on the socket
   daemon runs validators (schema, id-uniqueness, tombstone-order)
   daemon writes to ~/.mykb/areas/<id>/facts.jsonl  ✓
   daemon syncs FTS index
   daemon returns ok
```

Container user (`node` in `vf-agents-pi`) need not match daemon user. The RO bind-mount kills the bash-bypass categorically because the enforcement is in the kernel mount table, which the in-container LLM cannot reach.

## Layered architecture

Four layers, drawn vertically (top = client, bottom = bytes):

```
┌──────────────────────────────────────────────────────────────────┐
│ L4  Wire API (Facade)                                            │
│     add_fact / add_decision / add_gotcha / add_pattern /         │
│     add_link / tombstone / verify / promote / archive / compact  │
│     list_entries / get_entry / search                            │
│     create_workspace / journal / add_note / set_state / …        │
│     init_area / update_area_metadata / regenerate_manifest       │
│     ── this is ALL the daemon exposes ──                         │
├──────────────────────────────────────────────────────────────────┤
│ L3  Domain (Repository + Validators + FTS sync)                  │
│     EntryRepository, AreaRepository, ManifestRepository,         │
│     WorkspaceRepository                                          │
│                                                                  │
│     Chain-of-Responsibility validators:                          │
│       SchemaValidator → IdUniquenessValidator →                  │
│       TombstoneOrderingValidator → FtsSyncObserver               │
│                                                                  │
│     Today's `src/core/*` lives here, behind these repositories   │
├──────────────────────────────────────────────────────────────────┤
│ L2  Storage Backend (Strategy)                                   │
│     interface StorageBackend {                                   │
│       appendLine, readLines, replaceFile,                        │
│       readJson, writeJson, listDirs, lock                        │
│     }                                                            │
│     impls: LocalFsBackend │ S3Backend │ NfsBackend │ PgBackend   │
│     (v2 day-1: LocalFsBackend only)                              │
├──────────────────────────────────────────────────────────────────┤
│ L1  Transport (framing, request/response, error codes)           │
│     Unix-socket today; TLS-socket for remote daemon later        │
└──────────────────────────────────────────────────────────────────┘
```

### API surface decision — semantic only on the wire

L4 exposes only semantic operations. L2 primitives stay private to the daemon process.

Reasons, by SOLID:

- **SRP** — L4's single responsibility is "validated brain mutations and reads." If `append_line` is exposed alongside `add_fact`, the wire layer is now responsible for both "domain operations" and "raw storage" — two reasons to change. The bash-bypass we are fixing is literally what happens when raw storage is reachable from outside its layer.
- **OCP** — adding an S3 backend means a new L2 implementation. If primitives were on the wire, every client (extension, kb CLI, future cloud-sync agent) would couple to file-shaped concepts. Hiding L2 keeps the wire closed against backend evolution.
- **LSP** — any L2 backend must be substitutable behind the same L3 repositories. If clients reach L2 through the wire, they observe backend-specific semantics (append atomicity, listing order, lock granularity) and stop being substitutable in practice.
- **ISP** — the extension's `MykbStore` needs roughly 8 semantic operations. It does not need `append_line`, `read_bytes`, `acquire_lock`. Exposing them widens its dependency surface for zero benefit.
- **DIP** — L3 depends on the `StorageBackend` abstraction, not on `LocalFsBackend`. L4 depends on L3 repositories, not on L2 primitives. Each layer talks to abstractions one rung down, never two.

### Reads on the wire too

Reads belong on L4 even though day-1 deployment uses bind-mount reads for performance. Without semantic read operations on the wire, the cloud backend (where there is no bind-mount) has no way to serve queries — and you would be designing a second protocol later for reads, which is exactly the kind of architectural debt the layering is supposed to prevent.

Day-1 still optimizes: the local-FS deployment uses bind-mount reads as a fast path; the protocol allows daemon reads as the contract. Future cloud deployments use daemon reads exclusively. The contract is stable; the optimization is per-deployment.

### Operator vs extension surface

The L4 wire serves two client roles:

- **Extension** (in-container Pi) — mutation operations (`add_*`, `tombstone`, `verify`), reads, workspace state operations.
- **Operator** (`kb` CLI on host) — everything above, plus maintenance (`compact`, `rebuild`, `init_area`, `regenerate_manifest`).

Day-1 these are one socket, all ops. The protocol does not prevent splitting them later — operator commands gated by a different token / socket / capability than the extension's mutation commands is a v2.1 RBAC nicety to enable when there is a concrete need (e.g., a service-account autonomous curator that should not be able to call `compact`).

## Design patterns

Pattern landings, by layer:

| Pattern | Layer | Use |
|---|---|---|
| **Strategy** | L2 | `StorageBackend` is the strategy interface; `LocalFsBackend`, `S3Backend`, `NfsBackend`, `PgBackend` are interchangeable strategies. Swappable at daemon startup via config. |
| **Repository** | L3 | `EntryRepository.add(area, type, entry)` is the domain-facing operation; composes validators + an L2 backend call + observer notifications. Hides storage shape from L4. |
| **Chain of Responsibility** | L3 | Validators are an ordered chain: schema → id-uniqueness → tombstone-order → (next). Each can short-circuit with a typed error. New invariant = new link in the chain, no existing code changes (OCP). |
| **Observer** | L3 | `FtsSyncObserver` subscribes to repository write events; SQLite index update happens out-of-band of the mutation contract. Future cloud backends register a different observer — e.g., publish to a queue. |
| **Facade** | L4 | The wire RPC handler is a thin facade over L3 repositories. No business logic; just translate RPC frame → repository call → RPC response. |
| **Adapter** | client side | `RpcMykbStore` adapts the existing `MykbStore` interface to L1 transport calls. `LocalMykbStore` (today's direct-FS code) stays as a parallel implementation for unit tests and dev-mode. They are LSP-substitutable behind the same `MykbStore` interface the extension already depends on. |
| **Command** | wire frames | Each request is `{ op, args, id }`. Gives free audit-log (just persist the command stream), replay, and queue-backed deployments later. |

## Backend extensibility

The Strategy at L2 is the architectural payoff beyond the bash-bypass fix. Once `StorageBackend` is the abstraction, the daemon can back onto:

- Local filesystem (day-1, identical to today's `~/.mykb` layout)
- S3 / Azure Blob / GCS — multi-host shared brain
- NFS / SMB share — same idea, lower-friction
- A different host entirely over the network (daemon promotes from Unix socket to TLS)
- Postgres / SQLite-as-service — proper relational backend
- A queue (Kafka, NATS) with downstream subscribers — auditing, replication

Three caveats, because "the daemon enables this" is true and "you get it for free" is not:

1. **Protocol must be semantic, not primitive** (already decided above — this is the load-bearing constraint).
2. **Concurrency model changes per backend.** Local JSONL is single-process exclusive append. S3 has no append (PUT-with-version, or compaction-style writes). NFS has fragile lock semantics. The L4 API can stay the same, but each L2 implementation has to solve its own write-coordination problem; the abstraction does not make that go away.
3. **Reads change per backend.** Local-FS has the bind-mount fast path; cloud backends do not. Per the "Reads on the wire" decision above, the protocol already accommodates this — but the read-consistency story (cache-staleness, write-then-read) is per-backend and needs explicit treatment in each L2 implementation.

## What moves vs stays

This is **re-homing, not rewriting**. The existing `src/core/*` modules do not get thrown out; they become the daemon's internal code.

### Moves into the daemon

- All mutating logic in `src/core/store.ts` (`appendEntry`, `tombstone`, `compact`).
- Schema validation, id-uniqueness, tombstone ordering, FTS sync — the invariant enforcers.
- `src/core/{area,manifest,workspace,init}.ts` writes.
- Whatever lock semantics exist today.
- Read primitives the daemon owns (semantic search, list, get-entry — though day-1 the bind-mount short-circuit means these are rarely called).

### Stays in the clients

- **`kb` CLI**: commander parsing, argv shaping, terminal output rendering — `kb list`, `kb load`, `kb recent`, the markdown rendering of areas, the "Resume" section composition for `kb work start`. All UX, not invariant.
- **Pi extension**: command registration with Pi, the `kb_add` / `kb_load` / `kb_search` tool surface the LLM sees, formatting `load area X` output into a turn-shaped string, the `mykb-loaded-areas` Pi message contract. All UX/integration.
- All `experiments/` / `EXPERIMENT.md` scaffolding.

### Duplication removed

Today `kb` CLI calls `src/core/store.ts` directly **and** the extension's `MykbStore` ALSO calls `src/core/store.ts` directly. Two pathways into the same business logic, sharing it only by colocation. After the move there is exactly one pathway (the wire), and the CLI and extension are siblings of each other — both clients of the same service — instead of two roots into shared internals.

## Scope — container-only for v2

The daemon enforces against **the kb-spike-style containerized Pi runtime**. The operator-host `kb-pi` path (the `~/.bashrc` shell function that launches Pi directly on the host as the operator user) is **out of scope for v2**.

Rationale:

- The empirically-observed bypass was in a containerized scenario; the threat we are closing is "autonomous LLM session against the brain."
- `kb-pi` on host is a human-supervised dev loop where the operator can already `rm -rf ~/.mykb` at any moment; the gate does not add safety the operator does not already have.
- Closing the host case costs real engineering: either (a) split into a `mykb` system user that owns the brain and grants the daemon write while the Pi-user gets only read perms (filesystem ACLs), or (b) Landlock / AppArmor profile that restricts Pi's bash from knowledge paths. Both are real work; Landlock is cleaner but Node-side support is thin.
- The in-process app-layer hook stays as the cooperative-LLM guardrail on the host path.

This scope statement should be written into a project memory once v2 implementation starts: **"any unsupervised LLM session against the brain runs in the container."**

The host-mode enforcement is a v2.1 add-on if and when an unattended host runtime appears.

## Migration / dev mode / backwards compat

### Backwards compatibility — free, by deliberate constraint

L2's `LocalFsBackend` uses the **same on-disk format** as today. `~/.mykb/` directories do not move. JSONL stays JSONL. SQLite index stays. The daemon is purely an ingress layer in front of today's filesystem layout. v0.2.x brains keep working with the v2 daemon with no migration.

This constraint is non-negotiable for L2 LocalFsBackend; future cloud backends are free to choose their own on-disk shape.

### Dev-mode strategy

Two parallel `MykbStore` implementations behind the same interface:

- **`RpcMykbStore`** — production path; calls daemon over Unix socket. Used by Pi extension and `kb` CLI in normal operation.
- **`LocalMykbStore`** — direct-to-disk; **identical to today's behavior**. Used by:
  - Unit tests (no daemon to manage; fast feedback)
  - Dev-mode outside containers (`kb` CLI run directly by the operator without a daemon running)
  - The kb-spike harness's in-process L1 tests

Selecting which one to use is a startup-time decision driven by env or config (`MYKB_STORE=rpc|local`, defaulting to `local` for `kb` CLI and `rpc` for the extension inside the container).

The daemon ships with an `npm run daemon:dev` target for quick local startup against `~/.mykb`. Production daemon runs as a systemd-managed service.

**The deliberate consequence**: `LocalMykbStore` does **not** participate in the v2 trust boundary. It is bypass-by-design, meant only for trusted contexts (tests, host operator). The boundary is enforced at the container/mount layer, not in the store code path.

## Open decisions

Decisions that remain after this design pass — to be resolved before implementation begins:

1. **Wire protocol shape** — JSON-RPC 2.0 over Unix socket, HTTP-over-Unix-socket (gives free middleware ecosystem, but heavier), or custom length-prefixed JSON framing. Lean: JSON-RPC 2.0 for ecosystem fit; defer until prototyping.
2. **Auth model on the socket** — purely OS perms (socket file mode + bind-mount), or a token in the L1 handshake? Day-1 OS perms are sufficient; token-based is an OCP-friendly add when RBAC becomes meaningful.
3. **Backpressure / failure modes** — what happens when the daemon is down or unreachable? Fail-fast vs. local write-ahead queue vs. degraded read-only mode? Lean: fail-fast with a clear error surfaced to the LLM (which retries through the cooperative path).
4. **Concurrency on LocalFsBackend** — single-writer (the daemon is the only writer) makes file locking unnecessary in day-1. But the operator's `kb` CLI running as `LocalMykbStore` against the same `~/.mykb` violates that assumption. Either (a) when the daemon is running, the operator CLI must use `RpcMykbStore`; (b) keep flock semantics defensively. Lean: (a) with detection ("daemon socket present → use it").
5. **Exact L4 verb set** — the table above is illustrative; the canonical list is one design-doc revision away. Worth a short follow-up doc once protocol shape is chosen.
6. **Daemon supervision** — systemd unit, runit, or `pm2`-style? Operational concern, not architectural; defer.

## Work breakdown

Indicative phasing. Estimates are notional; each phase ends with a working `npm test` and a passing experiment matrix.

| # | Phase | Effort | Deliverable |
|---|---|---|---|
| 1 | **Protocol contract** | 1–2 sessions | This DESIGN doc's L4 verb set canonicalized; JSON-RPC schema; error taxonomy. One document, no code. |
| 2 | **Daemon scaffold** | ~1 week | `mykbd` binary; L1 transport; L4 facade dispatching to L3 repositories; L2 `LocalFsBackend` reuses today's `src/core/*`. No client integration yet. Stand-alone CLI tests against the socket. |
| 3 | **`RpcMykbStore` adapter** | ~2–3 days | Client-side adapter behind the existing `MykbStore` interface. Unit tests with a mock daemon. |
| 4 | **Pi extension switchover** | ~2–3 days | Extension selects `RpcMykbStore` when the daemon socket is bind-mounted in; `LocalMykbStore` otherwise. L4 experiments updated. |
| 5 | **`kb` CLI switchover** | ~3–5 days | Larger client; each subcommand audited. Maintains `LocalMykbStore` fallback for direct-disk operator mode. |
| 6 | **Container topology** | ~2 days | `vf-agents-pi` definition: brain mounted RO; daemon socket bind-mounted in. systemd unit for the host daemon. |
| 7 | **Regression closure** | ~1 day | `experiments/tool-gating/EXPERIMENT.md` updates: `bash-bypass-known-gap` flips from 🐛 to ✅; new positive scenario `kb_add-via-daemon-works` proves the validated channel still serves writes. |
| 8 | **Operational hardening** | open-ended | Logging, metrics, daemon health endpoint, audit-log retention policy, RBAC if/when needed. |

Phases 2–7 are roughly the v2 implementation window for this commitment. Phase 1 is design follow-up that should land before phase 2 starts.

## Experiments / regression homes

- `experiments/tool-gating/EXPERIMENT.md` — `bash-bypass-known-gap` row is the regression home. When the daemon ships and the container topology is in place, this scenario must transition from 🐛 to ✅. The transition is the acceptance criterion for the work.
- New experiment (proposed): `experiments/privileged-write-channel/` — proves end-to-end that (a) the RO bind-mount returns EROFS for direct writes, (b) `kb_add` succeeds via the daemon path, (c) the daemon's validators reject malformed JSONL, (d) the daemon survives client crashes mid-transaction.

## Related artifacts

| Kind | ID / Path | Purpose |
|---|---|---|
| GitHub issue | [#1](https://github.com/vilosource/mykb/issues/1) | Tracking issue — "tool-gating bash-bypass: design a privileged write channel for the brain" |
| kb gotcha | `K1yQnjNV` | Empirical observation of the bash-bypass |
| kb decision | `Iw3j51Sr` | 2026-05-11 triage: hybrid issue tracking + tag as v2 design item |
| Experiment | `experiments/tool-gating/EXPERIMENT.md` | Includes "Fix paths" section and `bash-bypass-known-gap` known-fail scenario |
| Research | `docs/v2-harness-memory-RESEARCH.md` | Write boundaries / OWASP MCP Top 10 context |
| Roadmap | `docs/v2-roadmap-PLAN.md` | The §16 commitments roadmap (this design is **separate** from those 10 items) |

## Open questions for v2 implementation start

To resurface before phase 2:

- Have any of the §16 commitments (envelope-v2, two-stage retrieval, etc.) changed the L3 schema in ways that affect this design's L4 verb set?
- Is there a concrete second harness in play that pushes operator-host enforcement (out-of-scope today) back into scope?
- Has any other client appeared (mempalace, vfdash, agent skills) that wants to write to mykb? They would also become L4 clients with the same `MykbStore` interface.
