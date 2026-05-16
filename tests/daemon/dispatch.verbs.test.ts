import { describe, it, expect } from 'vitest';
import { withTempBrain } from '../helpers.js';
import { initBrain } from '../../src/core/init.js';
import { createArea } from '../../src/core/area.js';
import { Dispatcher } from '../../src/daemon/dispatch.js';
import { DaemonError } from '../../src/daemon/errors.js';

// Verb-set completion (contract §5) + the METHOD_NOT_FOUND-vs-UNSUPPORTED_OP
// fidelity rule (§6): a verb IN the contract but not yet wired is
// UNSUPPORTED_OP; a verb NOT in the contract is METHOD_NOT_FOUND.

const OP = { capability: 'operator' as const };
const AGENT = { capability: 'agent' as const };

function brain(bp: string) {
  initBrain(bp);
  createArea(bp, 'docker', 'Docker', 'containers');
  const d = new Dispatcher(bp);
  d.dispatch('create_workspace', { id: 'ws1', name: 'WS One' }, AGENT);
  return d;
}

describe('workspace area-link & lifecycle verbs', () => {
  it('link_area / read_workspace / unlink_area round-trip', async () => {
    await withTempBrain(async (bp) => {
      const d = brain(bp);
      d.dispatch('link_area', { id: 'ws1', area: 'docker' }, AGENT);
      let ws = (
        d.dispatch('read_workspace', { id: 'ws1' }, AGENT) as {
          workspace: { areas: string[] };
        }
      ).workspace;
      expect(ws.areas).toContain('docker');
      d.dispatch('unlink_area', { id: 'ws1', area: 'docker' }, AGENT);
      ws = (
        d.dispatch('read_workspace', { id: 'ws1' }, AGENT) as {
          workspace: { areas: string[] };
        }
      ).workspace;
      expect(ws.areas).not.toContain('docker');
    });
  });

  it('resolve_workspace_id returns the canonical id', async () => {
    await withTempBrain(async (bp) => {
      const d = brain(bp);
      expect(d.dispatch('resolve_workspace_id', { id: 'ws1' }, AGENT)).toEqual({
        id: 'ws1',
      });
    });
  });

  it('set / clear active workspace', async () => {
    await withTempBrain(async (bp) => {
      const d = brain(bp);
      d.dispatch('set_active_workspace', { id: 'ws1' }, AGENT);
      expect(d.dispatch('get_active_workspace', {}, AGENT)).toEqual({ id: 'ws1' });
      d.dispatch('clear_active_workspace', {}, AGENT);
      expect(d.dispatch('get_active_workspace', {}, AGENT)).toEqual({ id: null });
    });
  });

  it('update_workspace_links + archive_workspace', async () => {
    await withTempBrain(async (bp) => {
      const d = brain(bp);
      d.dispatch('update_workspace_links', { id: 'ws1', links: { jira: 'ABC-1' } }, AGENT);
      expect(() => d.dispatch('archive_workspace', { id: 'ws1' }, AGENT)).not.toThrow();
    });
  });

  it('note + handoff lifecycle (append/delete note, write/clear handoff)', async () => {
    await withTempBrain(async (bp) => {
      const d = brain(bp);
      const { id } = d.dispatch(
        'append_note',
        { id: 'ws1', text: 'a note', tags: ['x'] },
        AGENT,
      ) as { id: string };
      d.dispatch('delete_note', { id: 'ws1', note_id: id }, AGENT);
      expect(
        (d.dispatch('read_notes', { id: 'ws1' }, AGENT) as { notes: unknown[] }).notes,
      ).toHaveLength(0);
      d.dispatch('write_handoff', { id: 'ws1', text: 'resume here' }, AGENT);
      d.dispatch('clear_handoff', { id: 'ws1' }, AGENT);
      expect(d.dispatch('read_handoff', { id: 'ws1' }, AGENT)).toEqual({
        handoff: null,
      });
    });
  });
});

describe('artifact verbs (§5.5)', () => {
  it('add → read_content → list → delete round-trip', async () => {
    await withTempBrain(async (bp) => {
      const d = brain(bp);
      const { id } = d.dispatch(
        'add_artifact',
        { workspace_id: 'ws1', filename: 'plan.md', content: '# Plan\n' },
        AGENT,
      ) as { id: string };
      expect(
        d.dispatch(
          'read_artifact_content',
          { workspace_id: 'ws1', id_or_filename: 'plan.md' },
          AGENT,
        ),
      ).toEqual({ content: '# Plan\n' });
      expect(
        (
          d.dispatch('list_artifacts', { workspace_id: 'ws1' }, AGENT) as {
            artifacts: unknown[];
          }
        ).artifacts,
      ).toHaveLength(1);
      d.dispatch('delete_artifact', { workspace_id: 'ws1', id }, AGENT);
      expect(
        (
          d.dispatch('list_artifacts', { workspace_id: 'ws1' }, AGENT) as {
            artifacts: unknown[];
          }
        ).artifacts,
      ).toHaveLength(0);
    });
  });

  it('sync_artifacts returns the tracked/untracked/missing triad', async () => {
    await withTempBrain(async (bp) => {
      const d = brain(bp);
      const r = d.dispatch('sync_artifacts', { workspace_id: 'ws1' }, AGENT) as {
        tracked: unknown[];
        untracked: unknown[];
        missing: unknown[];
      };
      expect(r).toHaveProperty('tracked');
      expect(r).toHaveProperty('untracked');
      expect(r).toHaveProperty('missing');
    });
  });
});

describe('recent_activity (§5.6)', () => {
  it('returns an activity object', async () => {
    await withTempBrain(async (bp) => {
      const d = brain(bp);
      const r = d.dispatch('recent_activity', { days: 7 }, AGENT) as Record<string, unknown>;
      expect(r).toBeTypeOf('object');
    });
  });
});

describe('contract fidelity — UNSUPPORTED_OP vs METHOD_NOT_FOUND (§6)', () => {
  it('a contracted-but-unwired verb (area_stats) → UNSUPPORTED_OP, not METHOD_NOT_FOUND', async () => {
    await withTempBrain(async (bp) => {
      const d = brain(bp);
      try {
        d.dispatch('area_stats', { area: 'docker' }, AGENT);
        expect.unreachable();
      } catch (e) {
        expect((e as DaemonError).kind).toBe('UNSUPPORTED_OP');
      }
    });
  });

  it('rebuild is contracted-but-unwired → UNSUPPORTED_OP', async () => {
    await withTempBrain(async (bp) => {
      const d = brain(bp);
      try {
        d.dispatch('rebuild', {}, OP);
        expect.unreachable();
      } catch (e) {
        expect((e as DaemonError).kind).toBe('UNSUPPORTED_OP');
      }
    });
  });

  it('a verb NOT in the contract at all → METHOD_NOT_FOUND', async () => {
    await withTempBrain(async (bp) => {
      const d = brain(bp);
      try {
        d.dispatch('frobnicate', {}, OP);
        expect.unreachable();
      } catch (e) {
        expect((e as DaemonError).kind).toBe('METHOD_NOT_FOUND');
      }
    });
  });
});
