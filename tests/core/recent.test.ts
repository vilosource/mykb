import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileSystemWorkspaceStorage } from '../../src/core/workspace.js';
import { getRecentActivity, renderRecent, type RecentActivity } from '../../src/core/recent.js';

// Fixed clock so window arithmetic is deterministic. NOW is 2026-05-11 12:00 UTC;
// the default `-d 2` cutoff is therefore 2026-05-09 12:00 UTC.
const NOW = new Date('2026-05-11T12:00:00.000Z');

const tmpDirs: string[] = [];
function tmpBrain(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mykb-recent-test-'));
  tmpDirs.push(d);
  return d;
}

// `FileSystemWorkspaceStorage.{get,set}ActiveWorkspaceId` route through the
// process-wide /tmp session file when `KB_SESSION_ID` is set in the ambient
// environment (the agent runtimes set it). Clear it so this in-process test
// uses each temp brain's `.active` file — and, crucially, never writes to a
// real session pointer. (Mirrors `withTempBrain` in tests/helpers.ts.)
let savedSessionId: string | undefined;
beforeEach(() => {
  savedSessionId = process.env.KB_SESSION_ID;
  delete process.env.KB_SESSION_ID;
});
afterEach(() => {
  if (savedSessionId === undefined) delete process.env.KB_SESSION_ID;
  else process.env.KB_SESSION_ID = savedSessionId;
  while (tmpDirs.length) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

interface WsFixture {
  name?: string;
  updated?: string;
  state?: { phase?: string; active?: string; next?: string; blocked?: string };
  journal?: Array<{ date: string; text: string }>;
  notes?: Array<{ id: string; date: string; text?: string; tags?: string[]; deleted?: true }>;
  handoff?: { text: string; updated?: string };
}

function writeWorkspace(brain: string, id: string, f: WsFixture = {}): void {
  const dir = path.join(brain, 'workspaces', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'workspace.json'),
    JSON.stringify(
      {
        id,
        name: f.name ?? id,
        state: f.state ?? {},
        areas: [],
        links: {},
        artifacts: [],
        created: '2026-01-01T00:00:00.000Z',
        updated: f.updated ?? '2026-01-01T00:00:00.000Z',
      },
      null,
      2,
    ) + '\n',
  );
  if (f.journal) {
    fs.writeFileSync(
      path.join(dir, 'journal.jsonl'),
      f.journal.map((e) => JSON.stringify(e)).join('\n') + '\n',
    );
  }
  if (f.notes) {
    fs.writeFileSync(
      path.join(dir, 'notes.jsonl'),
      f.notes
        .map((n) =>
          JSON.stringify(
            n.deleted
              ? { id: n.id, deleted: true, updated: n.date }
              : { id: n.id, date: n.date, text: n.text ?? '', tags: n.tags ?? [] },
          ),
        )
        .join('\n') + '\n',
    );
  }
  if (f.handoff) {
    const fm = f.handoff.updated ? `---\nupdated: ${f.handoff.updated}\n---\n` : '';
    fs.writeFileSync(path.join(dir, 'continuity.md'), fm + f.handoff.text + '\n');
  }
}

function writeArea(
  brain: string,
  id: string,
  entries: Array<{ id: string; text?: string; updated: string; deleted?: true }>,
): void {
  const dir = path.join(brain, 'areas', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'area.json'),
    JSON.stringify(
      {
        id,
        name: id,
        summary: `${id} summary`,
        owner: '',
        tags: [],
        created: '2026-01-01T00:00:00.000Z',
        updated: '2026-01-01T00:00:00.000Z',
      },
      null,
      2,
    ) + '\n',
  );
  fs.writeFileSync(
    path.join(dir, 'facts.jsonl'),
    entries
      .map((e) =>
        JSON.stringify(
          e.deleted
            ? { id: e.id, area: id, deleted: true, updated: e.updated }
            : {
                id: e.id,
                area: id,
                type: 'fact',
                text: e.text ?? `fact ${e.id}`,
                tags: [],
                provenance: { status: 'unverified' },
                zone: 'active',
                created: e.updated,
                updated: e.updated,
              },
        ),
      )
      .join('\n') + '\n',
  );
}

function recent(brain: string, opts: Parameters<typeof getRecentActivity>[2] = {}): RecentActivity {
  return getRecentActivity(brain, new FileSystemWorkspaceStorage(brain), { now: NOW, ...opts });
}

describe('getRecentActivity', () => {
  it('returns empty digest for an empty brain (no throw)', () => {
    const a = recent(tmpBrain());
    expect(a.workspaces).toEqual([]);
    expect(a.areas).toEqual([]);
    expect(a.all).toBe(false);
  });

  it('default window is the last 2 days; older-only workspaces are excluded; newest first', () => {
    const brain = tmpBrain();
    writeWorkspace(brain, 'alpha', {
      journal: [{ date: '2026-05-10T08:00:00.000Z', text: 'yesterday work' }],
    });
    writeWorkspace(brain, 'bravo', {
      journal: [{ date: '2026-05-05T08:00:00.000Z', text: 'six days ago' }],
    });
    writeWorkspace(brain, 'charlie', {
      journal: [{ date: '2026-05-11T09:00:00.000Z', text: 'today work' }],
    });

    const a = recent(brain);
    expect(a.workspaces.map((w) => w.id)).toEqual(['charlie', 'alpha']); // bravo out; today before yesterday
    expect(a.since).toBe('2026-05-09T12:00:00.000Z');
  });

  it('--all ignores the window and includes every workspace, still newest first', () => {
    const brain = tmpBrain();
    writeWorkspace(brain, 'alpha', { journal: [{ date: '2026-05-10T08:00:00.000Z', text: 'y' }] });
    writeWorkspace(brain, 'bravo', {
      journal: [{ date: '2026-05-05T08:00:00.000Z', text: 'old' }],
    });
    writeWorkspace(brain, 'charlie', {
      journal: [{ date: '2026-05-11T09:00:00.000Z', text: 't' }],
    });

    const a = recent(brain, { all: true });
    expect(a.all).toBe(true);
    expect(a.since).toBe('');
    expect(a.workspaces.map((w) => w.id)).toEqual(['charlie', 'alpha', 'bravo']);
  });

  it('an explicit --since cutoff filters by ISO string comparison', () => {
    const brain = tmpBrain();
    writeWorkspace(brain, 'kept', { journal: [{ date: '2026-05-10T00:00:01.000Z', text: 'in' }] });
    writeWorkspace(brain, 'dropped', {
      journal: [{ date: '2026-05-09T23:59:59.000Z', text: 'out' }],
    });
    const a = recent(brain, { since: '2026-05-10' });
    expect(a.workspaces.map((w) => w.id)).toEqual(['kept']);
  });

  it('activity count = in-window journal entries + in-window resolved notes (tombstones excluded)', () => {
    const brain = tmpBrain();
    writeWorkspace(brain, 'ws', {
      journal: [
        { date: '2026-05-04T08:00:00.000Z', text: 'old, out of window' },
        { date: '2026-05-10T08:00:00.000Z', text: 'in window 1' },
        { date: '2026-05-11T08:00:00.000Z', text: 'in window 2' },
      ],
      notes: [
        { id: 'n1', date: '2026-05-10T09:00:00.000Z', text: 'note in window' },
        { id: 'n2', date: '2026-05-04T09:00:00.000Z', text: 'note out of window' },
        { id: 'n3', date: '2026-05-11T09:00:00.000Z', text: 'note then deleted' },
        { id: 'n3', date: '2026-05-11T09:30:00.000Z', deleted: true },
      ],
    });
    const a = recent(brain);
    const w = a.workspaces[0];
    expect(w.journalCount).toBe(2);
    expect(w.noteCount).toBe(1); // n1 only: n2 out of window, n3 tombstoned
  });

  it('lastActivity is the max of workspace.updated, journal, notes, handoff — a stale workspace.json with a recent journal entry still counts as recent', () => {
    const brain = tmpBrain();
    // workspace.json.updated is ancient, but there's a journal entry today.
    writeWorkspace(brain, 'staleJson', {
      updated: '2026-01-01T00:00:00.000Z',
      journal: [{ date: '2026-05-11T07:00:00.000Z', text: 'fresh journal entry' }],
    });
    // A workspace whose only signal is a recent handoff (no journal, no notes).
    writeWorkspace(brain, 'handoffOnly', {
      updated: '2026-01-01T00:00:00.000Z',
      handoff: { text: 'next: do the thing', updated: '2026-05-10T15:00:00.000Z' },
    });
    // A workspace with everything ancient — must be excluded.
    writeWorkspace(brain, 'ancient', {
      updated: '2026-01-01T00:00:00.000Z',
      journal: [{ date: '2026-01-02T00:00:00.000Z', text: 'long ago' }],
    });

    const a = recent(brain);
    expect(a.workspaces.map((w) => w.id).sort()).toEqual(['handoffOnly', 'staleJson']);
    expect(a.workspaces.find((w) => w.id === 'staleJson')!.lastActivity).toBe(
      '2026-05-11T07:00:00.000Z',
    );
    expect(a.workspaces.find((w) => w.id === 'handoffOnly')!.lastActivity).toBe(
      '2026-05-10T15:00:00.000Z',
    );
  });

  it('summary: in-window journal lines (newest first) when present; otherwise the fallback chain', () => {
    const brain = tmpBrain();
    writeWorkspace(brain, 'withJournal', {
      journal: [
        { date: '2026-05-10T08:00:00.000Z', text: 'older in-window milestone' },
        { date: '2026-05-11T08:00:00.000Z', text: 'newest milestone' },
      ],
    });
    writeWorkspace(brain, 'handoffFallback', {
      updated: '2026-05-11T06:00:00.000Z',
      handoff: {
        text: '\n  resume here: the auth refactor  \nmore detail',
        updated: '2026-05-11T06:00:00.000Z',
      },
    });
    writeWorkspace(brain, 'stateFallback', {
      updated: '2026-05-11T06:00:00.000Z',
      state: { active: 'wiring the rate limiter', next: 'add retries' },
    });

    const a = recent(brain);
    const wj = a.workspaces.find((w) => w.id === 'withJournal')!;
    expect(wj.journalLines[0]).toBe('newest milestone');
    expect(wj.journalLines).toEqual(['newest milestone', 'older in-window milestone']);

    const wh = a.workspaces.find((w) => w.id === 'handoffFallback')!;
    expect(wh.journalLines).toEqual([]);
    expect(wh.fallbackSummary).toBe('resume here: the auth refactor');

    const ws = a.workspaces.find((w) => w.id === 'stateFallback')!;
    expect(ws.journalLines).toEqual([]);
    expect(ws.fallbackSummary).toBe('wiring the rate limiter');
  });

  it('"-"/blank journal entries are placeholders: they count toward journalCount but are skipped in the summary lines', () => {
    const brain = tmpBrain();
    writeWorkspace(brain, 'ws', {
      journal: [
        { date: '2026-05-10T08:00:00.000Z', text: 'a real milestone' },
        { date: '2026-05-11T08:00:00.000Z', text: '-' },
        { date: '2026-05-11T09:00:00.000Z', text: '   ' },
      ],
    });
    const a = recent(brain);
    const w = a.workspaces[0];
    expect(w.journalCount).toBe(3); // all three are "activity"
    expect(w.journalLines).toEqual(['a real milestone']); // the "-"/blank ones dropped
  });

  it('fallbackSummary uses the newest non-trivial journal entry of ANY date when there is no in-window journal line and no handoff', () => {
    const brain = tmpBrain();
    // workspace.json.updated is in-window (so the workspace shows) but the only
    // journal entry is old (out of window). No handoff. Expect the fallback to
    // surface that old entry's text.
    writeWorkspace(brain, 'ws', {
      updated: '2026-05-11T06:00:00.000Z',
      journal: [{ date: '2026-02-01T00:00:00.000Z', text: 'the last thing that happened here' }],
    });
    const a = recent(brain);
    const w = a.workspaces[0];
    expect(w.journalCount).toBe(0);
    expect(w.journalLines).toEqual([]);
    expect(w.fallbackSummary).toBe('the last thing that happened here');
  });

  it('phase and active marker reflect workspace.state.phase and getActiveWorkspaceId()', () => {
    const brain = tmpBrain();
    writeWorkspace(brain, 'one', {
      state: { phase: 'design' },
      journal: [{ date: '2026-05-11T08:00:00.000Z', text: 'x' }],
    });
    writeWorkspace(brain, 'two', {
      state: { phase: 'implementation' },
      journal: [{ date: '2026-05-11T08:00:00.000Z', text: 'y' }],
    });
    new FileSystemWorkspaceStorage(brain).setActiveWorkspaceId('two');

    const a = recent(brain);
    expect(a.workspaces.find((w) => w.id === 'one')!.phase).toBe('design');
    expect(a.workspaces.find((w) => w.id === 'one')!.active).toBe(false);
    expect(a.workspaces.find((w) => w.id === 'two')!.active).toBe(true);
  });

  it('areas: counts resolved entries updated in the window; tombstoned entries do not count; areas with no recent entries are omitted', () => {
    const brain = tmpBrain();
    // recentArea: one entry updated today, two updated 10 days ago.
    writeArea(brain, 'recentArea', [
      { id: 'a1', updated: '2026-05-11T10:00:00.000Z' },
      { id: 'a2', updated: '2026-05-01T10:00:00.000Z' },
      { id: 'a3', updated: '2026-05-01T10:00:00.000Z' },
    ]);
    // staleArea: everything old → omitted.
    writeArea(brain, 'staleArea', [{ id: 'b1', updated: '2026-04-01T10:00:00.000Z' }]);
    // tombstonedArea: the one entry was created today then deleted today → resolves to nothing → omitted.
    writeArea(brain, 'tombstonedArea', [
      { id: 'c1', updated: '2026-05-11T10:00:00.000Z' },
      { id: 'c1', deleted: true, updated: '2026-05-11T11:00:00.000Z' },
    ]);

    const a = recent(brain);
    expect(a.areas.map((x) => x.id)).toEqual(['recentArea']);
    expect(a.areas[0].entryCount).toBe(1);
    expect(a.areas[0].lastUpdated).toBe('2026-05-11T10:00:00.000Z');
  });
});

describe('renderRecent', () => {
  function sampleActivity(): RecentActivity {
    return {
      since: '2026-05-09T12:00:00.000Z',
      generatedAt: NOW.toISOString(),
      all: false,
      workspaces: [
        {
          id: 'mykb',
          name: 'mykb',
          phase: 'v2-implementation',
          active: true,
          lastActivity: '2026-05-11T10:00:00.000Z', // 2h before NOW
          journalCount: 3,
          noteCount: 0,
          journalLines: [
            'Closed the 3 scaffolded-only matrices: kb-add, kb-verify, kb-command — and fixed the never-worked /kb command bug; this sentence is deliberately long enough to require truncation by renderRecent so we can assert the ellipsis appears at the end of the rendered line.',
            'earlier milestone',
          ],
          fallbackSummary: '',
        },
        {
          id: 'hetzner',
          name: 'hetzner',
          phase: 'extadmin pool: designed',
          active: false,
          lastActivity: '2026-05-10T12:00:00.000Z', // ~yesterday
          journalCount: 1,
          noteCount: 0,
          journalLines: [],
          fallbackSummary: 'next: implement the extadmin pool',
        },
      ],
      areas: [
        { id: 'mykb', entryCount: 2, lastUpdated: '2026-05-11T09:45:00.000Z' },
        { id: 'hetzner', entryCount: 1, lastUpdated: '2026-05-10T11:00:00.000Z' },
      ],
    };
  }

  it('renders the two sections with the active marker, phase, counts and a journal one-liner', () => {
    const out = renderRecent(sampleActivity(), { width: 80 });
    expect(out).toContain('Recent activity — since 2026-05-09');
    expect(out).toContain('WORKSPACES');
    expect(out).toContain('AREAS');
    expect(out).toMatch(/\*\s+mykb/); // active marker on mykb
    expect(out).toContain('v2-implementation');
    expect(out).toContain('3 entries');
    expect(out).toContain('1 entry'); // singular for hetzner
    expect(out).toContain('2h ago');
    expect(out).toMatch(/└ Closed the 3 scaffolded-only matrices.*…/); // truncated with ellipsis
    expect(out).toContain('└ next: implement the extadmin pool'); // fallback used when no journal lines
    expect(out).toContain('mykb'); // areas section
  });

  it('--full shows multiple journal lines per workspace', () => {
    const out = renderRecent(sampleActivity(), { width: 200, full: true });
    expect(out).toContain('earlier milestone');
  });

  it('non-full shows only the latest journal line per workspace', () => {
    const out = renderRecent(sampleActivity(), { width: 200, full: false });
    expect(out).not.toContain('earlier milestone');
  });

  it('renders an empty digest as a "(no recent activity)" note', () => {
    const out = renderRecent({
      since: '2026-05-09T12:00:00.000Z',
      generatedAt: NOW.toISOString(),
      all: false,
      workspaces: [],
      areas: [],
    });
    expect(out).toContain('no recent activity');
  });

  it('renders the --all header without a date', () => {
    const out = renderRecent({ ...sampleActivity(), all: true, since: '' });
    expect(out).toContain('all (no time window)');
  });
});
