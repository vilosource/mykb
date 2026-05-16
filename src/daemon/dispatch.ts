/**
 * L4 facade — verb dispatch (`docs/v2-protocol-contract-DESIGN.md` §5).
 *
 * Thin Facade over today's `src/core/*` (parent DESIGN §"What moves vs
 * stays" — re-homing, not rewriting): no business logic here, just
 * translate verb + params → core call → result, enforce the per-verb
 * capability requirement (§2.2), and map core errors onto the typed
 * taxonomy (§6).
 *
 * Scope of this scaffold slice: every verb that maps 1:1 onto the current
 * `KnowledgeStore` / `WorkspaceStorage` surface is implemented. The
 * envelope-v2-specific behaviour is deliberately deferred (contract §8
 * separates the wire from envelope-v2 behaviour):
 *   - `supersede_entry` → UNSUPPORTED_OP until the `superseded_by` schema
 *     field exists (§3.1b); the wire verb is reserved now.
 *   - `trust`/`validity`/`origin` add-params are ACCEPTED (forward-compat,
 *     §3.1a) but not persisted by the pre-envelope-v2 core; only the
 *     trust-cap security check is enforced now.
 * Contracted-but-not-yet-wired verbs return UNSUPPORTED_OP (verb valid,
 * backend can't do it yet) rather than METHOD_NOT_FOUND (verb not in the
 * contract at all).
 */

import { MykbStore } from '../core/knowledge-store.js';
import { FileSystemWorkspaceStorage } from '../core/workspace.js';
import {
  areaExists,
  createArea,
  listAreas,
  updateAreaMetadata,
  readAreaMetadata,
} from '../core/area.js';
import { regenerateManifest, readManifest } from '../core/manifest.js';
import { save } from '../core/save.js';
import {
  EntryNotFoundError,
  WorkspaceNotFoundError,
  EntryValidationError,
  ArtifactNotFoundError,
} from '../core/errors.js';
import { DaemonError } from './errors.js';
import type { Capability, ConnContext } from './capability.js';

const PROTOCOL = 1;

type Params = Record<string, unknown>;
type Handler = (p: Params, ctx: ConnContext) => unknown;
interface VerbDef {
  cap: 'A' | 'O'; // A = any connection, O = operator-only (§5)
  fn: Handler;
}

function str(p: Params, key: string): string {
  const v = p[key];
  if (typeof v !== 'string' || v.length === 0) {
    throw new DaemonError('INVALID_PARAMS', `param '${key}' must be a non-empty string`, {
      param: key,
    });
  }
  return v;
}

function optStr(p: Params, key: string): string | undefined {
  const v = p[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'string') {
    throw new DaemonError('INVALID_PARAMS', `param '${key}' must be a string`, {
      param: key,
    });
  }
  return v;
}

/** Capability cap on an asserted trust level (§2.2 / §3.1a). */
function checkTrust(p: Params, ctx: ConnContext): void {
  if (p.trust === 'operator' && ctx.capability !== 'operator') {
    throw new DaemonError(
      'TRUST_DENIED',
      "asserting trust:'operator' requires an operator-capability connection",
      { asserted: 'operator', capability: ctx.capability },
    );
  }
}

/** Translate a thrown core error into the typed wire taxonomy (§6). */
function translate(e: unknown): never {
  if (e instanceof DaemonError) throw e;
  if (e instanceof EntryNotFoundError) throw new DaemonError('ENTRY_NOT_FOUND', e.message);
  if (e instanceof WorkspaceNotFoundError) throw new DaemonError('WORKSPACE_NOT_FOUND', e.message);
  if (e instanceof ArtifactNotFoundError) throw new DaemonError('ENTRY_NOT_FOUND', e.message);
  if (e instanceof EntryValidationError) throw new DaemonError('SCHEMA_INVALID', e.message);
  const msg = e instanceof Error ? e.message : String(e);
  if (/area '.*' not found/i.test(msg) || /not found.*area/i.test(msg))
    throw new DaemonError('AREA_NOT_FOUND', msg);
  throw new DaemonError('INTERNAL_ERROR', msg);
}

export class Dispatcher {
  private readonly brainPath: string;
  private _store?: MykbStore;
  private _ws?: FileSystemWorkspaceStorage;
  private readonly verbs: Record<string, VerbDef>;

  constructor(brainPath: string) {
    this.brainPath = brainPath;
    this.verbs = this.buildRegistry();
  }

  private store(): MykbStore {
    if (!this._store) this._store = MykbStore.open(this.brainPath);
    return this._store;
  }

  private ws(): FileSystemWorkspaceStorage {
    if (!this._ws) this._ws = new FileSystemWorkspaceStorage(this.brainPath);
    return this._ws;
  }

  private requireArea(area: string): void {
    if (!areaExists(this.brainPath, area)) {
      throw new DaemonError('AREA_NOT_FOUND', `area '${area}' does not exist`, { area });
    }
  }

  /** Dispatch a single L4 verb. Throws DaemonError on any failure. */
  dispatch(method: string, params: Params, ctx: ConnContext): unknown {
    const def = this.verbs[method];
    if (!def) {
      throw new DaemonError('METHOD_NOT_FOUND', `unknown verb: ${method}`, { method });
    }
    if (def.cap === 'O' && ctx.capability !== 'operator') {
      throw new DaemonError(
        'TRUST_DENIED',
        `verb '${method}' requires an operator-capability connection`,
        { method, capability: ctx.capability },
      );
    }
    try {
      return def.fn(params, ctx);
    } catch (e) {
      translate(e);
    }
  }

  private unsupported(method: string): never {
    throw new DaemonError(
      'UNSUPPORTED_OP',
      `verb '${method}' is reserved by the contract but not implemented by this backend yet`,
      { method },
    );
  }

  private addOpts(p: Params): Record<string, unknown> {
    // Pass through the options the current core understands; the
    // envelope-v2 params (trust/validity/origin) are accepted on the wire
    // (forward-compat §3.1a) but not persisted pre-envelope-v2.
    const o: Record<string, unknown> = {};
    if (Array.isArray(p.tags)) o.tags = p.tags;
    if (typeof p.zone === 'string') o.zone = p.zone;
    if (typeof p.source === 'string') o.provenance = { status: 'unverified', source: p.source };
    return o;
  }

  private buildRegistry(): Record<string, VerbDef> {
    const A = (fn: Handler): VerbDef => ({ cap: 'A', fn });
    const O = (fn: Handler): VerbDef => ({ cap: 'O', fn });

    return {
      // --- system (§5.7) ---
      ping: A(() => ({ ok: true })),
      hello: A((p, ctx) => ({
        protocol: PROTOCOL,
        daemon_version: '0.0.0',
        capability: ctx.capability,
        schema_version: 1,
      })),
      daemon_info: A((_p, ctx) => ({
        daemon_version: '0.0.0',
        protocol: PROTOCOL,
        capability: ctx.capability,
        backend: 'localfs',
      })),

      // --- knowledge add (§5.1) ---
      add_fact: A((p, ctx) => {
        checkTrust(p, ctx);
        this.requireArea(str(p, 'area'));
        const id = this.store().addFact(str(p, 'area'), str(p, 'text'), this.addOpts(p));
        return { id };
      }),
      add_decision: A((p, ctx) => {
        checkTrust(p, ctx);
        this.requireArea(str(p, 'area'));
        const o = this.addOpts(p);
        if (typeof p.why === 'string') (o as Record<string, unknown>).why = p.why;
        if (typeof p.rejected === 'string') (o as Record<string, unknown>).rejected = p.rejected;
        if (typeof p.context === 'string') (o as Record<string, unknown>).context = p.context;
        const id = this.store().addDecision(str(p, 'area'), str(p, 'text'), o);
        return { id };
      }),
      add_gotcha: A((p, ctx) => {
        checkTrust(p, ctx);
        this.requireArea(str(p, 'area'));
        const o = this.addOpts(p);
        if (typeof p.failed === 'boolean') (o as Record<string, unknown>).failed = p.failed;
        const id = this.store().addGotcha(str(p, 'area'), str(p, 'text'), o);
        return { id };
      }),
      add_pattern: A((p, ctx) => {
        checkTrust(p, ctx);
        this.requireArea(str(p, 'area'));
        const id = this.store().addPattern(str(p, 'area'), str(p, 'text'), this.addOpts(p));
        return { id };
      }),
      add_link: A((p, ctx) => {
        checkTrust(p, ctx);
        this.requireArea(str(p, 'area'));
        const id = this.store().addLink(
          str(p, 'area'),
          str(p, 'text'),
          str(p, 'url'),
          this.addOpts(p),
        );
        return { id };
      }),

      // --- knowledge lifecycle (§5.2) ---
      update_entry: A((p, ctx) => {
        const updates = (p.updates ?? {}) as Record<string, unknown>;
        if ('trust' in updates && ctx.capability !== 'operator') {
          throw new DaemonError(
            'TRUST_DENIED',
            'updating trust requires an operator-capability connection',
          );
        }
        this.requireArea(str(p, 'area'));
        this.store().updateEntry(str(p, 'area'), str(p, 'id'), updates);
        return {};
      }),
      delete_entry: A((p) => {
        this.requireArea(str(p, 'area'));
        this.store().deleteEntry(str(p, 'area'), str(p, 'id'));
        return {};
      }),
      verify_entry: O((p) => {
        this.requireArea(str(p, 'area'));
        this.store().verifyEntry(str(p, 'area'), str(p, 'id'));
        return {};
      }),
      promote_entry: A((p) => {
        this.requireArea(str(p, 'area'));
        this.store().promoteEntry(str(p, 'area'), str(p, 'id'));
        return {};
      }),
      archive_entry: A((p) => {
        this.requireArea(str(p, 'area'));
        this.store().archiveEntry(str(p, 'area'), str(p, 'id'));
        return {};
      }),
      supersede_entry: A(() => this.unsupported('supersede_entry')),

      // --- knowledge read (§5.3) ---
      load_area: A((p) => {
        this.requireArea(str(p, 'area'));
        return { entries: this.store().loadArea(str(p, 'area')) };
      }),
      list_entries: A((p) => {
        this.requireArea(str(p, 'area'));
        return { entries: this.store().loadArea(str(p, 'area')) };
      }),
      get_entry: A((p) => {
        const area = str(p, 'area');
        this.requireArea(area);
        const id = str(p, 'id');
        const entry = this.store()
          .loadArea(area)
          .find((e) => e.id === id);
        if (!entry)
          throw new DaemonError('ENTRY_NOT_FOUND', `entry '${id}' not in area '${area}'`, {
            area,
            id,
          });
        return { entry };
      }),
      search: A((p) => ({ entries: this.store().search(str(p, 'query')) })),
      match_areas: A((p) => ({ matches: this.store().matchAreas(str(p, 'text')) })),

      // --- workspace (§5.4) ---
      create_workspace: A((p) => {
        this.ws().createWorkspace(str(p, 'id'), str(p, 'name'));
        return {};
      }),
      read_workspace: A((p) => ({ workspace: this.ws().readWorkspace(str(p, 'id')) })),
      list_workspaces: A(() => ({ workspaces: this.ws().listWorkspaces() })),
      update_workspace_state: A((p) => {
        this.ws().updateWorkspaceState(str(p, 'id'), (p.state ?? {}) as never);
        return {};
      }),
      get_active_workspace: A(() => ({ id: this.ws().getActiveWorkspaceId() })),
      set_active_workspace: A((p) => {
        this.ws().setActiveWorkspaceId(str(p, 'id'));
        return {};
      }),
      append_journal: A((p) => {
        this.ws().appendJournal(str(p, 'id'), str(p, 'text'));
        return {};
      }),
      read_journal: A((p) => ({
        entries: this.ws().readJournal(
          str(p, 'id'),
          typeof p.limit === 'number' ? p.limit : undefined,
        ),
      })),
      append_note: A((p) => ({
        id: this.ws().appendNote(
          str(p, 'id'),
          str(p, 'text'),
          Array.isArray(p.tags) ? (p.tags as string[]) : undefined,
        ),
      })),
      read_notes: A((p) => ({
        notes: this.ws().readNotes(str(p, 'id'), optStr(p, 'tag')),
      })),
      write_handoff: A((p) => {
        this.ws().writeHandoff(str(p, 'id'), str(p, 'text'));
        return {};
      }),
      read_handoff: A((p) => ({ handoff: this.ws().readHandoff(str(p, 'id')) })),

      // --- area & maintenance (§5.6) ---
      init_area: O((p) => {
        createArea(this.brainPath, str(p, 'id'), str(p, 'name'), optStr(p, 'summary') ?? '');
        regenerateManifest(this.brainPath);
        return {};
      }),
      list_areas: A(() => ({ areas: listAreas(this.brainPath) })),
      read_area_metadata: A((p) => ({
        meta: readAreaMetadata(this.brainPath, str(p, 'id')),
      })),
      update_area_metadata: O((p) => {
        updateAreaMetadata(this.brainPath, str(p, 'id'), (p.updates ?? {}) as never);
        return {};
      }),
      regenerate_manifest: O(() => {
        regenerateManifest(this.brainPath);
        return {};
      }),
      read_manifest: A(() => ({ manifest: readManifest(this.brainPath) })),
      compact: O((p) => {
        this.store().compact(optStr(p, 'area'));
        return {};
      }),
      save: O((p) => {
        save(this.brainPath, optStr(p, 'message'));
        return {};
      }),
    };
  }
}

export type { Capability };
