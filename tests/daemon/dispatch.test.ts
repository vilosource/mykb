import { describe, it, expect } from 'vitest';
import { withTempBrain } from '../helpers.js';
import { initBrain } from '../../src/core/init.js';
import { createArea } from '../../src/core/area.js';
import { Dispatcher } from '../../src/daemon/dispatch.js';
import { DaemonError } from '../../src/daemon/errors.js';

// L4 facade dispatch — v2-protocol-contract-DESIGN.md §5.
// Driven WITHOUT a socket (the socket server is a later slice): this is
// the integration level of the pyramid — real src/core + a temp brain.

const OP = { capability: 'operator' as const };
const AGENT = { capability: 'agent' as const };

function freshBrain(brainPath: string) {
  initBrain(brainPath);
  createArea(brainPath, 'docker', 'Docker', 'container stuff');
  return new Dispatcher(brainPath);
}

describe('L4 dispatch — knowledge verbs', () => {
  it('add_fact returns an id and the entry is then loadable', async () => {
    await withTempBrain(async (bp) => {
      const d = freshBrain(bp);
      const { id } = d.dispatch('add_fact', { area: 'docker', text: 'cgroups isolate' }, AGENT) as {
        id: string;
      };
      expect(id).toMatch(/\w+/);
      const { entries } = d.dispatch('load_area', { area: 'docker' }, AGENT) as {
        entries: { id: string; text: string }[];
      };
      expect(entries.map((e) => e.text)).toContain('cgroups isolate');
    });
  });

  it('add_decision carries why/rejected through to the stored entry', async () => {
    await withTempBrain(async (bp) => {
      const d = freshBrain(bp);
      const { id } = d.dispatch(
        'add_decision',
        { area: 'docker', text: 'use overlayfs', why: 'fast', rejected: 'aufs' },
        AGENT,
      ) as { id: string };
      const { entry } = d.dispatch('get_entry', { area: 'docker', id }, AGENT) as {
        entry: Record<string, unknown>;
      };
      expect(entry.why).toBe('fast');
    });
  });

  it('search finds an added entry', async () => {
    await withTempBrain(async (bp) => {
      const d = freshBrain(bp);
      d.dispatch('add_fact', { area: 'docker', text: 'layered images' }, AGENT);
      const { entries } = d.dispatch('search', { query: 'layered' }, AGENT) as {
        entries: unknown[];
      };
      expect(entries).toHaveLength(1);
    });
  });

  it('accepts the envelope-v2 optional params without rejecting (forward-compat §3.1)', async () => {
    await withTempBrain(async (bp) => {
      const d = freshBrain(bp);
      expect(() =>
        d.dispatch(
          'add_fact',
          { area: 'docker', text: 'x', trust: 'agent', origin: { kind: 'manual' } },
          AGENT,
        ),
      ).not.toThrow();
    });
  });
});

describe('L4 dispatch — capability gate (§2.2 / §5)', () => {
  it('verify_entry from an agent connection is TRUST_DENIED', async () => {
    await withTempBrain(async (bp) => {
      const d = freshBrain(bp);
      const { id } = d.dispatch('add_fact', { area: 'docker', text: 'verify me' }, AGENT) as {
        id: string;
      };
      try {
        d.dispatch('verify_entry', { area: 'docker', id }, AGENT);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(DaemonError);
        expect((e as DaemonError).kind).toBe('TRUST_DENIED');
        expect((e as DaemonError).code).toBe(-32020);
      }
    });
  });

  it('verify_entry from an operator connection succeeds', async () => {
    await withTempBrain(async (bp) => {
      const d = freshBrain(bp);
      const { id } = d.dispatch('add_fact', { area: 'docker', text: 'verify me' }, OP) as {
        id: string;
      };
      expect(() => d.dispatch('verify_entry', { area: 'docker', id }, OP)).not.toThrow();
    });
  });

  it('an agent asserting trust:operator on add_fact is TRUST_DENIED', async () => {
    await withTempBrain(async (bp) => {
      const d = freshBrain(bp);
      try {
        d.dispatch('add_fact', { area: 'docker', text: 'x', trust: 'operator' }, AGENT);
        expect.unreachable();
      } catch (e) {
        expect((e as DaemonError).kind).toBe('TRUST_DENIED');
      }
    });
  });

  it('operator-only maintenance verb (compact) is TRUST_DENIED for an agent', async () => {
    await withTempBrain(async (bp) => {
      const d = freshBrain(bp);
      expect(() => d.dispatch('compact', {}, AGENT)).toThrow(DaemonError);
      try {
        d.dispatch('compact', {}, AGENT);
      } catch (e) {
        expect((e as DaemonError).kind).toBe('TRUST_DENIED');
      }
    });
  });
});

describe('L4 dispatch — error taxonomy translation (§6)', () => {
  it('get_entry on a missing entry → ENTRY_NOT_FOUND', async () => {
    await withTempBrain(async (bp) => {
      const d = freshBrain(bp);
      try {
        d.dispatch('get_entry', { area: 'docker', id: 'nope' }, AGENT);
        expect.unreachable();
      } catch (e) {
        expect((e as DaemonError).kind).toBe('ENTRY_NOT_FOUND');
      }
    });
  });

  it('read_workspace on a missing workspace returns null (contract §5.4, nullable)', async () => {
    await withTempBrain(async (bp) => {
      const d = freshBrain(bp);
      expect(d.dispatch('read_workspace', { id: 'ghost' }, AGENT)).toEqual({
        workspace: null,
      });
    });
  });

  it('a mutation on a missing workspace (append_journal) → WORKSPACE_NOT_FOUND', async () => {
    await withTempBrain(async (bp) => {
      const d = freshBrain(bp);
      try {
        d.dispatch('append_journal', { id: 'ghost', text: 'x' }, AGENT);
        expect.unreachable();
      } catch (e) {
        expect((e as DaemonError).kind).toBe('WORKSPACE_NOT_FOUND');
      }
    });
  });

  it('add_fact missing the required text param → INVALID_PARAMS', async () => {
    await withTempBrain(async (bp) => {
      const d = freshBrain(bp);
      try {
        d.dispatch('add_fact', { area: 'docker' }, AGENT);
        expect.unreachable();
      } catch (e) {
        expect((e as DaemonError).kind).toBe('INVALID_PARAMS');
      }
    });
  });

  it('an unknown verb → METHOD_NOT_FOUND', async () => {
    await withTempBrain(async (bp) => {
      const d = freshBrain(bp);
      try {
        d.dispatch('frobnicate', {}, OP);
        expect.unreachable();
      } catch (e) {
        expect((e as DaemonError).kind).toBe('METHOD_NOT_FOUND');
      }
    });
  });

  it('supersede_entry is UNSUPPORTED_OP until envelope-v2 lands (§3.1b / §8)', async () => {
    await withTempBrain(async (bp) => {
      const d = freshBrain(bp);
      const a = d.dispatch('add_fact', { area: 'docker', text: 'old' }, AGENT) as {
        id: string;
      };
      const b = d.dispatch('add_fact', { area: 'docker', text: 'new' }, AGENT) as {
        id: string;
      };
      try {
        d.dispatch('supersede_entry', { area: 'docker', old_id: a.id, new_id: b.id }, AGENT);
        expect.unreachable();
      } catch (e) {
        expect((e as DaemonError).kind).toBe('UNSUPPORTED_OP');
      }
    });
  });
});

describe('L4 dispatch — workspace & system verbs', () => {
  it('create_workspace → append_journal → read_journal round-trips', async () => {
    await withTempBrain(async (bp) => {
      const d = freshBrain(bp);
      d.dispatch('create_workspace', { id: 'ws1', name: 'WS One' }, AGENT);
      d.dispatch('append_journal', { id: 'ws1', text: 'did a thing' }, AGENT);
      const { entries } = d.dispatch('read_journal', { id: 'ws1', limit: 5 }, AGENT) as {
        entries: { text: string }[];
      };
      expect(entries.at(-1)?.text).toBe('did a thing');
    });
  });

  it('ping returns ok and hello echoes the connection capability', async () => {
    await withTempBrain(async (bp) => {
      const d = freshBrain(bp);
      expect(d.dispatch('ping', {}, AGENT)).toEqual({ ok: true });
      const hello = d.dispatch(
        'hello',
        { client: 'kb-cli', client_version: '0.0.0', protocol: 1 },
        OP,
      ) as { capability: string; protocol: number };
      expect(hello.capability).toBe('operator');
      expect(hello.protocol).toBe(1);
    });
  });

  it('init_area is operator-only and creates a loadable area', async () => {
    await withTempBrain(async (bp) => {
      const d = freshBrain(bp);
      expect(() => d.dispatch('init_area', { id: 'k8s', name: 'K8s' }, AGENT)).toThrow(DaemonError);
      d.dispatch('init_area', { id: 'k8s', name: 'K8s', summary: 'orchestration' }, OP);
      const { areas } = d.dispatch('list_areas', {}, AGENT) as {
        areas: { id: string }[];
      };
      expect(areas.map((a) => a.id)).toContain('k8s');
    });
  });
});
