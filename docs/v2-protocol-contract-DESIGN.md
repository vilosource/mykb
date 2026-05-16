# v2 Protocol Contract — L4 Verb Set, JSON-RPC Schema, Error Taxonomy

> Status: contract — Phase 1 deliverable of `v2-privileged-write-channel-DESIGN.md` (GitHub issue [#1](https://github.com/vilosource/mykb/issues/1)).
> This is the "one document, no code" that the parent DESIGN's Work Breakdown (§Work breakdown, row 1) requires to land **before** Phase 2 (daemon scaffold) starts.
>
> Parent: `v2-privileged-write-channel-DESIGN.md` (architecture, threat model, layering, alternatives).
> Companions that constrain this contract: `envelope-v2-DESIGN.md` (L3 schema additions), `v2-roadmap-PLAN.md` (sequencing), `v2-harness-memory-RESEARCH.md` (write boundaries / OWASP MCP Top 10).
>
> What this document is: the canonical, frozen-for-Phase-2 wire contract. Phase 2 implements *exactly* this surface; deviations require a revision to this doc, not an ad-hoc code decision.

## 1. Scope

The parent DESIGN left six **open decisions** (§Open decisions) and three **open questions for v2 implementation start** (§Open questions for v2 implementation start). Phase 2 cannot begin until they are resolved, because they determine the wire shape, the verb set, and the error model the daemon scaffold must implement.

This document:

1. Resolves all six open decisions (§2).
2. Answers all three open questions — including the load-bearing one: *does envelope-v2 change the L4 verb set?* (§3).
3. Specifies the wire protocol: framing, request/response, handshake, versioning (§4).
4. Canonicalizes the L4 verb set — every verb, its params, its return shape, its capability requirement — derived from the **actual** `KnowledgeStore` and `WorkspaceStorage` interfaces in `src/core/types.ts`, not the illustrative table in the parent DESIGN (§5).
5. Specifies the error taxonomy and its mapping onto the L3 Chain-of-Responsibility validators (§6).
6. States the Phase 1 acceptance criteria and what Phase 2 consumes (§7).

Out of scope (deferred, by §2): daemon supervision mechanism, RBAC token model, cloud-backend wire extensions.

## 2. Resolved open decisions

The parent DESIGN's six open decisions, each now decided with rationale. These are binding for Phase 2.

### 2.1 Wire protocol shape → **JSON-RPC 2.0 over a length-prefixed Unix-socket frame**

Decided: JSON-RPC 2.0 request/response objects, each frame length-prefixed (4-byte big-endian uint32 byte count, then the UTF-8 JSON body). No HTTP.

- JSON-RPC 2.0 chosen over custom framing for ecosystem fit (well-understood request/notification/error envelope, `id` correlation, batch support is in-spec if ever needed) and over HTTP-over-Unix-socket because HTTP buys a middleware ecosystem the daemon does not need and pays header/parser weight on every brain mutation.
- Length-prefix rather than newline-delimited: brain content (entry `text`, journal bodies, artifact content) contains arbitrary newlines; a newline delimiter would require escaping the payload. A byte count does not.
- The `{ op, args, id }` "Command" framing the parent DESIGN's pattern table promises maps onto JSON-RPC's `{ method, params, id }` 1:1. `method` = the L4 verb (§5); `params` = a single named-object (never positional — positional params couple the wire to argument order, an LSP hazard when backends evolve).

### 2.2 Auth model → **OS peer credentials (`SO_PEERCRED`), single socket, capability derived per-connection**

Decided: day-1 is OS perms, but *refined* beyond the parent DESIGN's "socket file mode + bind-mount" because envelope-v2's `trust` field (§3.1) forces the daemon to distinguish operator-capable connections from extension connections.

- One socket day-1 (parent DESIGN §Operator vs extension surface). The daemon reads the connecting peer's credentials via `SO_PEERCRED` (Linux) at accept time and assigns the connection a **capability set**:
  - `operator` capability — peer uid is the brain-owning uid (the uid that owns `~/.mykb`). May call maintenance verbs (§5.6) and may assert `trust: 'operator'` on writes.
  - `agent` capability — any other peer (the in-container Pi extension runs as a different uid per parent DESIGN §Topology, "Container user need not match daemon user"). May call mutation + read + workspace verbs; **any `trust` it asserts is capped at `agent`** (§3.1).
- No token in the L1 handshake day-1. A token is an OCP-friendly add (new optional handshake field, §4.4) when RBAC becomes meaningful (e.g. a service-account autonomous curator that must not call `compact`). Designed-for, not built.
- This resolves the parent DESIGN's open decision 2 *and* closes the envelope-v2 trust-forgery hole in one mechanism: the kernel attests the peer uid; the daemon does not trust a client's self-asserted trust level beyond its connection capability.

### 2.3 Backpressure / failure modes → **fail-fast with a typed error; client falls back to the cooperative path**

Decided: when the daemon is down, unreachable, or returns `BACKEND_UNAVAILABLE`, the client (`RpcMykbStore`) raises a typed error immediately. No local write-ahead queue (it would reintroduce an in-container write surface — the exact thing the channel exists to remove). No degraded read-only mode in the store layer.

- The extension surfaces the error to the LLM as a clear "the knowledge channel is unavailable; do not attempt to write the file directly" message — the cooperative-LLM guardrail (the in-process hook) is still loaded and still refuses `write`/`bash >`, so a daemon outage degrades to "cannot record knowledge this session," never to "knowledge written unsafely."
- Rationale: a write-ahead queue inside the container is a writable brain-adjacent surface; a poisoned/looping agent could fill it; flushing it later replays unvalidated intent. Fail-fast keeps the trust boundary categorical.

### 2.4 Concurrency on `LocalFsBackend` → **daemon is sole writer; client detects socket presence; defensive `flock` retained**

Decided: option (a) from the parent DESIGN (detection) with (b) as belt-and-suspenders.

- When the daemon socket is present, every client uses `RpcMykbStore`; the daemon is then the single writer and JSONL append ordering is naturally serialized inside the daemon's L3 (one event loop, queued writes).
- The operator's `kb` CLI run directly on the host **with no daemon running** uses `LocalMykbStore` (parent DESIGN §Dev-mode strategy) — bypass-by-design, trusted operator.
- The dangerous case is "daemon running *and* operator also runs `kb` as `LocalMykbStore` against the same `~/.mykb`." Resolution: the CLI's store-selection (§Phase 5) checks for a live socket first and prefers `RpcMykbStore` when present. The existing `flock` in `src/core/store.ts` is retained defensively (cheap, already written) so a misconfigured concurrent `LocalMykbStore` still cannot interleave a partial append.

### 2.5 Exact L4 verb set → **§5 of this document** (the deliverable).

### 2.6 Daemon supervision → **deferred to Phase 6** (operational, not architectural).

systemd unit vs runit vs pm2 is decided alongside the container topology in Phase 6, not here. The contract does not depend on it.

## 3. Open questions for v2 implementation start — answered

### 3.1 Has envelope-v2 changed the L3 schema in ways that affect this L4 verb set? — **YES. Three concrete effects, all foldable additively.**

`envelope-v2-DESIGN.md` adds, to `KnowledgeEntry`: `validity {valid_from, valid_until?, superseded_by?}`, `trust: 'operator'|'agent'|'import'`, and `provenance.origin`. The parent DESIGN explicitly states the privileged-write-channel ships **parallel to and independent of** the §16 commitments — so this contract must be **forward-compatible** with envelope-v2 without a protocol break, not blocked on it. The semantic-only-wire constraint already enables this; the specific effects:

**(a) Trust inference must move from the client process to the wire.** Today `trust` is inferred from `process.stdin.isTTY` and `MYKB_INVOCATION` (envelope-v2 §2). Once the daemon is the writer, *that context exists only client-side* — the daemon's socket accept cannot see the original TTY. Therefore:

- The `trust` field is an **explicit, optional wire parameter** on every `add_*` verb (§5.1). Absent ⇒ daemon defaults it to `agent` (envelope-v2's conservative default).
- The daemon **caps** the asserted trust by the connection capability (§2.2): an `agent`-capability connection asserting `trust: 'operator'` is rejected with `TRUST_DENIED` (§6). Only an `operator`-capability connection may assert `operator`.
- This is *not* optional hardening — without it the envelope-v2 trust gate (its Tier-1 security guard) is forgeable by any in-container LLM the moment it ships. The contract bakes the enforcement point in now even though the field defaults to absent until envelope-v2 phase 1 lands.

**(b) `supersede` is a first-class atomic verb, not two `update_entry` calls.** envelope-v2 §Migration: "The supersede flag updates both entries atomically: B gains a forward link, A gains `superseded_by=B.id`." Atomicity across a socket cannot be reconstructed from two independent `update_entry` round-trips. The contract defines a single compound verb `supersede_entry(area, old_id, new_id)` (§5.2) whose atomicity is a daemon-side L3 guarantee.

**(c) `verify` semantics expand; query verbs gain validity/supersession filters.** envelope-v2 §Migration phase 2 makes `kb verify` the operator-trust-upgrade signal (agent/import → operator). The L4 `verify_entry` contract therefore states that verify *also* upgrades `trust` to `operator` (daemon-side, only honored from an `operator`-capability connection — §2.2 again). And envelope-v2 phase 3 adds default filtering of `valid_until < today` / `superseded_by IS NOT NULL`: the read verbs `load_area`, `search`, `list_entries` carry optional `include_superseded` / `include_historical` flags (§5.3).

All three are **additive**: optional params + one new verb + expanded-but-backward-compatible `verify`. No existing verb's required shape changes. A Phase-2 daemon built today against this contract serves pre-envelope-v2 brains correctly (fields absent ⇒ defaults) and serves post-envelope-v2 brains correctly (fields present ⇒ honored) with no wire-protocol version bump. This is the OCP payoff of the semantic-only wire, made concrete.

### 3.2 Is there a concrete second harness pushing operator-host enforcement back into scope? — **No.**

The container path (kb-spike-style Pi runtime) remains the only unattended-LLM surface. The host `kb-pi` path is still the human-supervised dev loop (`CLAUDE.md` "Testing the kb extension on Pi from ~/KB" — operator-driven, operator can `rm -rf ~/.mykb` at any time). No unattended host runtime has appeared since the parent DESIGN. **Container-only scope (parent DESIGN §Scope) holds unchanged.** The project-memory line the parent DESIGN asks for ("any unsupervised LLM session against the brain runs in the container") is recorded as a kb decision when Phase 2 starts, not here.

### 3.3 Has any other client appeared that wants to write to mykb? — **One adjacent, not a direct L4 client.**

`mykb-curator` (built 2026-05-15→16, separate repo `vilosource/mykb-curator`) maintains wikis from a mykb brain and proposes brain mutations — but it does so by opening a **branch/PR on the kb git repo** (its `prbackend`), which the operator reviews and merges. It is a *git-level* proposer, not a socket-level writer; it never appends JSONL directly. It does **not** become an L4 client in v2. It is recorded here as the most likely *future* L4 client (if it ever gains an autonomous apply path, it joins as an `agent`-capability connection with the same `MykbStore` interface — exactly the OCP extension point §3.1(a) protects). mempalace (separate MCP brain) and vfdash (own DynamoDB backend) do not write mykb. No new direct write-client.

## 4. Wire protocol

### 4.1 Transport & framing

- Unix domain socket, `SOCK_STREAM`. Path: daemon config; default `${MYKB_DIR:-~/.mykb}/.mykbd.sock`. Inside the container the socket is bind-mounted in (parent DESIGN §Topology).
- Each message is a frame: `uint32 BE length` ‖ `JSON body (UTF-8, that many bytes)`. Max body 16 MiB (artifact content is the large case; larger uploads are an explicit future streaming verb, not silently allowed).
- The socket file is created mode `0600`, owned by the brain uid. (Capability still derives from `SO_PEERCRED`, not the file mode — the mode is defence-in-depth.)

### 4.2 Request

JSON-RPC 2.0 request object:

```json
{ "jsonrpc": "2.0", "id": <number|string>, "method": "<l4_verb>", "params": { ... } }
```

- `params` is always a **named object**, never positional (§2.1 rationale).
- `id` correlates response; omit `id` only for fire-and-forget notifications (none defined in v2 — every brain mutation must be acknowledged).

### 4.3 Response

Success:

```json
{ "jsonrpc": "2.0", "id": <same>, "result": { ... } }
```

Error (§6 taxonomy):

```json
{ "jsonrpc": "2.0", "id": <same>, "error": { "code": <int>, "message": "<human>", "data": { "kind": "<TYPED_KIND>", "detail": { ... } } } }
```

`error.data.kind` is the stable machine-readable discriminator (§6); `error.code` follows JSON-RPC conventions; `error.message` is human prose. Clients branch on `kind`, never on `message`.

### 4.4 Handshake & versioning

First frame on a new connection is a `hello`:

- Request: `{ method: "hello", params: { client: "extension"|"kb-cli"|"<name>", client_version: "<semver>", protocol: 1 } }`
- Response `result`: `{ protocol: 1, daemon_version: "<semver>", capability: "operator"|"agent", schema_version: <int> }`

`capability` is the `SO_PEERCRED`-derived set (§2.2) — echoed so the client can fail fast if it needs operator verbs and got `agent`. `schema_version` is the brain's envelope schema version (envelope-v2 §Storage layout `meta.schema_version`); lets a client detect a brain that needs `kb rebuild`. `protocol` integer is bumped only on a breaking wire change; additive verbs/params (the §3.1 envelope-v2 case) do **not** bump it. A future RBAC token is an additive optional `params.token` on `hello` — no version bump (§2.2).

## 5. Canonical L4 verb set

Derived from the real interfaces: `KnowledgeStore` (`src/core/types.ts:154`), `WorkspaceStorage` (`src/core/types.ts:295`), and the area/manifest/init/save/db operator surface (`src/core/{area,manifest,init,save,db,recent}.ts`). This **supersedes** the illustrative list in the parent DESIGN §Layered architecture.

Naming: `snake_case` wire verbs. `Cap` column: `A` = any connection (agent or operator), `O` = operator-capability only (§2.2). `Kind`: `M` mutation, `R` read.

### 5.1 Knowledge — add

| Verb | params | result | Cap | Kind |
|---|---|---|---|---|
| `add_fact` | `{ area, text, source?, tags?, zone?, trust?, validity?, origin? }` | `{ id }` | A | M |
| `add_decision` | `{ area, text, why?, rejected?, context?, tags?, zone?, trust?, validity?, origin? }` | `{ id }` | A | M |
| `add_gotcha` | `{ area, text, source?, failed?, tags?, zone?, trust?, validity?, origin? }` | `{ id }` | A | M |
| `add_pattern` | `{ area, text, tags?, zone?, trust?, validity?, origin? }` | `{ id }` | A | M |
| `add_link` | `{ area, text, url, tags?, zone?, trust?, validity?, origin? }` | `{ id }` | A | M |

`trust?`, `validity?`, `origin?` are the envelope-v2 forward-compat params (§3.1). Absent ⇒ daemon defaults (`trust`→`agent`, `validity.valid_from`→server time, `origin`→`undefined`). `trust:'operator'` from an `agent`-cap connection ⇒ `TRUST_DENIED`. Optionality means a pre-envelope-v2 daemon ignores them and a post-envelope-v2 daemon honors them — same wire.

### 5.2 Knowledge — lifecycle

| Verb | params | result | Cap | Kind |
|---|---|---|---|---|
| `update_entry` | `{ area, id, updates: { text?, tags?, zone?, source?, valid_until?, trust? } }` | `{}` | A | M |
| `delete_entry` | `{ area, id }` (writes tombstone) | `{}` | A | M |
| `verify_entry` | `{ area, id }` — also upgrades `trust→operator` (§3.1c) | `{}` | **O** | M |
| `promote_entry` | `{ area, id }` | `{}` | A | M |
| `archive_entry` | `{ area, id }` | `{}` | A | M |
| `supersede_entry` | `{ area, old_id, new_id }` — atomic dual update (§3.1b) | `{}` | A | M |

`updates.trust` is operator-only even on an otherwise `A` verb: the daemon rejects a `trust` field in `update_entry.updates` from an `agent`-cap connection with `TRUST_DENIED`. `verify_entry` is `O` because envelope-v2 makes verify the operator-trust signal — an agent verifying its own entry into operator-trust is the exact attack the trust gate exists to stop.

### 5.3 Knowledge — read

| Verb | params | result | Cap | Kind |
|---|---|---|---|---|
| `load_area` | `{ area, filter?: { type?, zone?, tag? }, include_superseded?, include_historical? }` | `{ entries: KnowledgeEntry[] }` | A | R |
| `get_entry` | `{ area, id }` | `{ entry: KnowledgeEntry \| null }` | A | R |
| `search` | `{ query, exclude_zone?, include_superseded?, include_historical? }` | `{ entries: KnowledgeEntry[] }` | A | R |
| `match_areas` | `{ text }` | `{ matches: { area, score }[] }` | A | R |
| `list_entries` | `{ area, filter?, include_superseded?, include_historical? }` | `{ entries: KnowledgeEntry[] }` | A | R |

`include_superseded` / `include_historical` default `false` (envelope-v2 phase 3 default filtering). On a pre-envelope-v2 brain they are no-ops. `get_entry` / `list_entries` are split out from `load_area` so a client can fetch one entry without the area-load cost (the parent DESIGN's reads-on-the-wire requirement; bind-mount fast-path is a per-deployment optimization, not a contract change).

### 5.4 Workspace

| Verb | params | result | Cap | Kind |
|---|---|---|---|---|
| `create_workspace` | `{ id, name, options?: { areas?, jira?, wiki?, repos? } }` | `{}` | A | M |
| `read_workspace` | `{ id }` | `{ workspace \| null }` | A | R |
| `resolve_workspace_id` | `{ id }` | `{ id }` | A | R |
| `update_workspace_state` | `{ id, state: { phase?, active?, blocked?, next? } }` | `{}` | A | M |
| `update_workspace_links` | `{ id, links: { jira?, wiki?, repos? } }` | `{}` | A | M |
| `link_area` / `unlink_area` | `{ id, area }` | `{}` | A | M |
| `list_workspaces` | `{}` | `{ workspaces: Workspace[] }` | A | R |
| `archive_workspace` | `{ id }` | `{}` | A | M |
| `get_active_workspace` | `{}` | `{ id \| null }` | A | R |
| `set_active_workspace` | `{ id }` | `{}` | A | M |
| `clear_active_workspace` | `{}` | `{}` | A | M |
| `append_journal` | `{ id, text }` | `{}` | A | M |
| `read_journal` | `{ id, limit? }` | `{ entries: JournalEntry[] }` | A | R |
| `append_note` | `{ id, text, tags? }` | `{ id }` | A | M |
| `read_notes` | `{ id, tag? }` | `{ notes: NoteEntry[] }` | A | R |
| `delete_note` | `{ id, note_id }` | `{}` | A | M |
| `write_handoff` | `{ id, text }` | `{}` | A | M |
| `read_handoff` | `{ id }` | `{ handoff \| null }` | A | R |
| `clear_handoff` | `{ id }` | `{}` | A | M |

### 5.5 Artifacts

| Verb | params | result | Cap | Kind |
|---|---|---|---|---|
| `add_artifact` | `{ workspace_id, filename, content, options?: { type?, description?, tags?, areas? } }` | `{ id }` | A | M |
| `read_artifact` | `{ workspace_id, id_or_filename }` | `{ artifact \| null }` | A | R |
| `read_artifact_content` | `{ workspace_id, id_or_filename }` | `{ content \| null }` | A | R |
| `update_artifact` | `{ workspace_id, id, updates }` | `{}` | A | M |
| `delete_artifact` | `{ workspace_id, id }` | `{}` | A | M |
| `list_artifacts` | `{ workspace_id }` | `{ artifacts: ArtifactEntry[] }` | A | R |
| `sync_artifacts` | `{ workspace_id }` | `{ tracked, untracked, missing }` | A | M |

### 5.6 Area & maintenance (operator-capability only)

| Verb | params | result | Cap | Kind |
|---|---|---|---|---|
| `init_area` | `{ id, name, summary? }` | `{}` | **O** | M |
| `read_area_metadata` | `{ id }` | `{ meta \| null }` | A | R |
| `update_area_metadata` | `{ id, updates }` | `{}` | **O** | M |
| `list_areas` | `{}` | `{ areas: AreaMetadata[] }` | A | R |
| `delete_area` | `{ id }` | `{}` | **O** | M |
| `regenerate_manifest` | `{}` | `{}` | **O** | M |
| `read_manifest` | `{}` | `{ manifest \| null }` | A | R |
| `compact` | `{ area? }` | `{}` | **O** | M |
| `rebuild` | `{}` | `{}` | **O** | M |
| `area_stats` | `{ area }` | `{ stats }` | A | R |
| `recent_activity` | `{ days?, since?, all?, git? }` | `{ activity }` | A | R |
| `save` | `{ message?, push? }` | `{}` | **O** | M |

`init_area`, `delete_area`, `compact`, `rebuild`, `regenerate_manifest`, `save`, `update_area_metadata` are operator-capability: these are brain-structure / git operations the in-container agent has no legitimate need to perform, and gating them now is the concrete realization of the parent DESIGN's "operator commands gated differently than the extension's mutation commands" — achieved via the `SO_PEERCRED` capability with zero token machinery (§2.2). `read_*` / `list_*` / `*_stats` stay `A`: reads are not the trust boundary.

### 5.7 System

| Verb | params | result | Cap | Kind |
|---|---|---|---|---|
| `hello` | handshake (§4.4) | handshake | A | R |
| `ping` | `{}` | `{ ok: true }` | A | R |
| `daemon_info` | `{}` | `{ daemon_version, protocol, schema_version, backend: "localfs" }` | A | R |

`ping` is the client's daemon-liveness probe for the §2.4 socket-presence detection and the §2.3 fail-fast decision.

## 6. Error taxonomy

JSON-RPC `error.code` ranges: standard `-32700/-32600/-32601/-32602/-32603` for parse/invalid-request/method-not-found/invalid-params/internal. Domain errors use the JSON-RPC implementation-defined band `-32000…-32099`, with the stable discriminator in `error.data.kind` (clients branch on `kind`, §4.3).

| `kind` | code | Meaning | Origin (L3 unless noted) |
|---|---|---|---|
| `AREA_NOT_FOUND` | -32001 | area id does not exist | AreaRepository |
| `ENTRY_NOT_FOUND` | -32002 | entry id not in area | EntryRepository |
| `WORKSPACE_NOT_FOUND` | -32003 | workspace id does not exist | WorkspaceRepository |
| `SCHEMA_INVALID` | -32010 | payload fails entry/workspace schema | `SchemaValidator` (CoR link 1) |
| `ID_CONFLICT` | -32011 | id-uniqueness violation | `IdUniquenessValidator` (CoR link 2) |
| `TOMBSTONE_ORDER` | -32012 | tombstone precedes/contradicts live entry | `TombstoneOrderingValidator` (CoR link 3) |
| `FTS_SYNC_FAILED` | -32013 | mutation written but FTS index update failed | `FtsSyncObserver` (post-write) |
| `TRUST_DENIED` | -32020 | connection asserted a trust/op above its capability | L4 facade (capability check, §2.2) |
| `READ_ONLY_BACKEND` | -32021 | backend refused write (EROFS / read-only mode) | L2 `StorageBackend` |
| `BACKEND_UNAVAILABLE` | -32030 | storage backend unreachable (fail-fast, §2.3) | L2 |
| `LOCK_TIMEOUT` | -32031 | could not acquire write lock in time | L2 (`flock`, §2.4) |
| `UNSUPPORTED_OP` | -32040 | verb valid but not implemented by this backend | L2 (e.g. future S3 no-append) |
| `BODY_TOO_LARGE` | -32041 | frame body exceeds 16 MiB (§4.1) | L1 transport |

The CoR ordering (`SCHEMA_INVALID` → `ID_CONFLICT` → `TOMBSTONE_ORDER` → `FtsSyncObserver`) is the parent DESIGN's L3 validator chain (§Design patterns, Chain of Responsibility). A new invariant = a new `kind` + a new chain link, no existing-code change (OCP) — the error taxonomy is the contract face of that extensibility. The first failing link short-circuits and returns its `kind`; validators do not accumulate.

`error.data.detail` carries machine-usable specifics (e.g. `ID_CONFLICT` → `{ id, area }`; `SCHEMA_INVALID` → `{ field, reason }`) so the client/LLM can correct and retry through the cooperative path rather than reaching for `bash`.

## 7. Phase 1 acceptance criteria & Phase 2 hand-off

**Phase 1 is complete when** this document: resolves all six parent open decisions (§2 ✅), answers all three open questions including the envelope-v2 impact analysis (§3 ✅), specifies framing + handshake + versioning (§4 ✅), canonicalizes the full verb set against the real interfaces with capability + kind annotations (§5 ✅), and defines the error taxonomy mapped onto the L3 CoR (§6 ✅). No code (parent DESIGN §Work breakdown row 1: "One document, no code").

**Phase 2 consumes this as a frozen contract.** Specifically Phase 2 must:

1. Implement L1 framing exactly per §4.1–4.3 — with TDD-first transport tests (round-trip framing, oversize-body → `BODY_TOO_LARGE`, partial-frame reassembly).
2. Implement the `SO_PEERCRED` capability assignment per §2.2 and the `hello` handshake per §4.4 — with integration tests asserting an `agent`-cap connection gets `TRUST_DENIED` on `verify_entry` / operator verbs / `trust:'operator'`.
3. Implement every §5 verb as an L4 facade dispatch to the L3 repositories, L3 reusing today's `src/core/*` behind `EntryRepository`/`AreaRepository`/`ManifestRepository`/`WorkspaceRepository` (parent DESIGN §What moves vs stays — re-homing, not rewriting).
4. Surface every §6 `kind` from the correct L3 CoR link / L2 backend — with a **contract test suite** (the pyramid's contract level) asserting each `kind` is produced by its trigger condition, runnable against any future `StorageBackend` so backend swaps stay LSP-substitutable.
5. The capstone Phase-2 scenario test stands the daemon on a real temp brain over a real Unix socket and drives a representative verb of each group (`add_fact`, `update_entry`, `supersede_entry`, `load_area`, workspace journal, an operator-only verb from both capabilities) end-to-end — the L4 scenario level of the testing pyramid.

The full testing pyramid (unit transport/validators → integration capability+handshake → contract error-taxonomy → scenario socket end-to-end) is therefore *specified by this contract*, not improvised in Phase 2.

## 8. Deferred (explicitly not in this contract)

- RBAC token model (§2.2) — additive `hello.params.token`, no protocol bump, build when a service-account curator needs sub-operator gating.
- Cloud-backend wire extensions (streaming upload > 16 MiB, server-side pagination cursors) — additive verbs when an S3/NFS backend (parent DESIGN §Backend extensibility) is actually built; the semantic-only wire keeps them OCP-additive.
- Daemon supervision (§2.6) — Phase 6.
- envelope-v2 *behavior* (Tier-1 trust demotion in the scorer, validity filtering in default loaders) is envelope-v2's own roadmap (`v2-roadmap-PLAN.md` priorities 2/5/6); this contract only guarantees the *wire* carries the fields so the two roadmaps stay independent (parent DESIGN §Relationship to the v2 roadmap).

## 9. Related artifacts

| Kind | ID / Path | Purpose |
|---|---|---|
| Parent design | `docs/v2-privileged-write-channel-DESIGN.md` | Architecture, threat model, layering, alternatives |
| Schema constraint | `docs/envelope-v2-DESIGN.md` | The L3 schema additions §3.1 folds in forward-compatibly |
| Sequencing | `docs/v2-roadmap-PLAN.md` | Confirms privileged-write-channel ships parallel to §16 |
| GitHub issue | [#1](https://github.com/vilosource/mykb/issues/1) | Tracking issue |
| Interfaces (source of truth for §5) | `src/core/types.ts` (`KnowledgeStore` :154, `WorkspaceStorage` :295) | The verb set is canonicalized from these, not invented |
