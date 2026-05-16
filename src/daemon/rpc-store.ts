/**
 * `RpcKnowledgeStore` — client-side Adapter (parent DESIGN §Design
 * patterns, "Adapter, client side") that presents the existing
 * synchronous `KnowledgeStore` interface while routing every operation
 * through the daemon over the L4 wire.
 *
 * LSP: behaviourally substitutable with the local `MykbStore` behind the
 * `KnowledgeStore` interface — including throwing the SAME typed core
 * errors, so call sites that `catch (EntryNotFoundError)` keep working
 * unchanged. The wire's typed `kind` (contract §6) is reconstructed back
 * into the core error class.
 */

import type {
  KnowledgeStore,
  KnowledgeEntry,
  AddFactOptions,
  AddDecisionOptions,
  AddGotchaOptions,
  AddPatternOptions,
  AddLinkOptions,
  EntryFilter,
  Zone,
} from '../core/types.js';
import {
  EntryNotFoundError,
  AreaNotFoundError,
  EntryValidationError,
  WorkspaceNotFoundError,
} from '../core/errors.js';
import { DaemonError } from './errors.js';
import { SyncRpcClient } from './sync-client.js';

function flatten(opts?: Record<string, unknown>): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  if (!opts) return o;
  if (Array.isArray(opts.tags)) o.tags = opts.tags;
  if (typeof opts.zone === 'string') o.zone = opts.zone;
  const prov = opts.provenance as { source?: string } | undefined;
  if (prov?.source) o.source = prov.source;
  for (const k of ['why', 'rejected', 'context', 'failed'] as const) {
    if (opts[k] !== undefined) o[k] = opts[k];
  }
  return o;
}

/** Map a wire error kind back onto the core error class (LSP parity). */
function rethrow(e: unknown): never {
  if (e instanceof DaemonError) {
    switch (e.kind) {
      case 'ENTRY_NOT_FOUND':
        throw new EntryNotFoundError(e.message);
      case 'AREA_NOT_FOUND':
        throw new AreaNotFoundError(e.message);
      case 'SCHEMA_INVALID':
      case 'INVALID_PARAMS':
        throw new EntryValidationError(e.message);
      case 'WORKSPACE_NOT_FOUND':
        throw new WorkspaceNotFoundError(e.message);
      default:
        throw e;
    }
  }
  throw e;
}

export class RpcKnowledgeStore implements KnowledgeStore {
  private readonly client: SyncRpcClient;

  constructor(socketPath: string) {
    this.client = new SyncRpcClient(socketPath);
  }

  private call(method: string, params: Record<string, unknown>): unknown {
    try {
      return this.client.call(method, params);
    } catch (e) {
      rethrow(e);
    }
  }

  private addId(verb: string, params: Record<string, unknown>): string {
    return (this.call(verb, params) as { id: string }).id;
  }

  addFact(area: string, text: string, options?: AddFactOptions): string {
    return this.addId('add_fact', { area, text, ...flatten(options) });
  }
  addDecision(area: string, text: string, options?: AddDecisionOptions): string {
    return this.addId('add_decision', { area, text, ...flatten(options) });
  }
  addGotcha(area: string, text: string, options?: AddGotchaOptions): string {
    return this.addId('add_gotcha', { area, text, ...flatten(options) });
  }
  addPattern(area: string, text: string, options?: AddPatternOptions): string {
    return this.addId('add_pattern', { area, text, ...flatten(options) });
  }
  addLink(area: string, text: string, url: string, options?: AddLinkOptions): string {
    return this.addId('add_link', { area, text, url, ...flatten(options) });
  }

  updateEntry(area: string, id: string, updates: Partial<KnowledgeEntry>): void {
    this.call('update_entry', { area, id, updates });
  }
  deleteEntry(area: string, id: string): void {
    this.call('delete_entry', { area, id });
  }
  verifyEntry(area: string, id: string): void {
    this.call('verify_entry', { area, id });
  }
  promoteEntry(area: string, id: string): void {
    this.call('promote_entry', { area, id });
  }
  archiveEntry(area: string, id: string): void {
    this.call('archive_entry', { area, id });
  }

  loadArea(area: string, filter?: EntryFilter): KnowledgeEntry[] {
    return (this.call('load_area', { area, filter }) as { entries: KnowledgeEntry[] }).entries;
  }
  search(query: string, excludeZone?: Zone): KnowledgeEntry[] {
    return (
      this.call('search', { query, exclude_zone: excludeZone }) as {
        entries: KnowledgeEntry[];
      }
    ).entries;
  }
  matchAreas(text: string): { area: string; score: number }[] {
    return (
      this.call('match_areas', { text }) as {
        matches: { area: string; score: number }[];
      }
    ).matches;
  }
  compact(area?: string): void {
    this.call('compact', area ? { area } : {});
  }

  /** Release the worker thread. Not part of KnowledgeStore; lifecycle. */
  close(): void {
    this.client.close();
  }
}
