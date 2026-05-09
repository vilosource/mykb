import { describe, it, expect } from 'vitest';
import {
  renderMarkdown,
  renderContextBlock,
  renderJournalContextBlock,
  renderAreaIndex,
  renderJson,
  renderWorkspace,
} from '../../src/core/render.js';
import type { KnowledgeEntry, AreaMetadata, Workspace, JournalEntry, AreaContext, HandoffData } from '../../src/core/types.js';
import { Zone, ProvenanceStatus } from '../../src/core/types.js';

function makeEntry(overrides: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  return {
    id: 'abc12345',
    area: 'my-area',
    type: 'fact',
    text: 'Test fact',
    tags: [],
    provenance: { status: ProvenanceStatus.Unverified },
    zone: Zone.Active,
    created: '2026-03-15T00:00:00.000Z',
    updated: '2026-03-15T00:00:00.000Z',
    ...overrides,
  };
}

describe('renderMarkdown', () => {
  it('renders entries as markdown bullet list', () => {
    const entries = [makeEntry({ text: 'fact one', tags: ['ts', 'dev'] })];
    const md = renderMarkdown(entries);
    expect(md).toContain('## my-area (Active)');
    expect(md).toContain('- fact one #ts #dev');
  });

  it('includes provenance date when verified', () => {
    const entries = [
      makeEntry({
        text: 'verified fact',
        provenance: { status: ProvenanceStatus.Verified, date: '2026-03-15' },
      }),
    ];
    const md = renderMarkdown(entries);
    expect(md).toContain('(verified:2026-03-15)');
  });

  it('handles empty entries', () => {
    const md = renderMarkdown([]);
    expect(md).toBe('');
  });

  it('groups entries by area', () => {
    const entries = [
      makeEntry({ area: 'area-a', text: 'fact a' }),
      makeEntry({ area: 'area-b', text: 'fact b' }),
    ];
    const md = renderMarkdown(entries);
    expect(md).toContain('## area-a (Active)');
    expect(md).toContain('## area-b (Active)');
  });
});

describe('renderContextBlock', () => {
  it('wraps content in mykb-context tags', () => {
    const areaEntries = new Map<string, KnowledgeEntry[]>([
      ['my-area', [makeEntry({ text: 'context fact' })]],
    ]);
    const output = renderContextBlock(areaEntries);
    expect(output).toContain('<mykb-context>');
    expect(output).toContain('</mykb-context>');
    expect(output).toContain('## my-area');
    expect(output).toContain('- context fact');
  });

  it('handles multiple areas', () => {
    const areaEntries = new Map<string, KnowledgeEntry[]>([
      ['area-a', [makeEntry({ area: 'area-a', text: 'fact a' })]],
      ['area-b', [makeEntry({ area: 'area-b', text: 'fact b' })]],
    ]);
    const output = renderContextBlock(areaEntries);
    expect(output).toContain('## area-a');
    expect(output).toContain('## area-b');
  });

  it('handles empty map', () => {
    const output = renderContextBlock(new Map());
    expect(output).toContain('<mykb-context>');
    expect(output).toContain('</mykb-context>');
  });
});

describe('renderJournalContextBlock', () => {
  const entries: JournalEntry[] = [
    { date: '2026-05-08T10:00:00.000Z', text: 'older milestone' },
    { date: '2026-05-09T11:30:00.000Z', text: 'newer milestone' },
  ];

  it('wraps journal entries in mykb-journal tags with workspace id and day count', () => {
    const out = renderJournalContextBlock(entries, 'mykb', 2);
    expect(out).toContain('<mykb-journal workspace="mykb" days="2">');
    expect(out).toContain('</mykb-journal>');
  });

  it('renders entries in chronological order with date prefix', () => {
    const out = renderJournalContextBlock(entries, 'mykb', 2);
    expect(out).toContain('- 2026-05-08: older milestone');
    expect(out).toContain('- 2026-05-09: newer milestone');
    // Older before newer in the rendered output
    const olderIdx = out.indexOf('older milestone');
    const newerIdx = out.indexOf('newer milestone');
    expect(olderIdx).toBeLessThan(newerIdx);
  });

  it('returns empty string when entries are empty', () => {
    const out = renderJournalContextBlock([], 'mykb', 2);
    expect(out).toBe('');
  });
});

describe('renderAreaIndex', () => {
  it('renders area list for system prompt', () => {
    const areas: AreaMetadata[] = [
      {
        id: 'my-area',
        name: 'My Area',
        summary: 'A test area',
        owner: 'user',
        tags: ['test'],
        created: '2026-03-15T00:00:00.000Z',
        updated: '2026-03-15T00:00:00.000Z',
      },
    ];
    const output = renderAreaIndex(areas);
    expect(output).toContain('my-area');
    expect(output).toContain('A test area');
  });

  it('handles empty areas', () => {
    const output = renderAreaIndex([]);
    expect(output).toBe('');
  });
});

describe('renderJson', () => {
  it('returns valid JSON string', () => {
    const entries = [makeEntry()];
    const json = renderJson(entries);
    const parsed = JSON.parse(json) as KnowledgeEntry[];
    expect(parsed).toHaveLength(1);
    expect(parsed[0].text).toBe('Test fact');
  });

  it('handles empty entries', () => {
    const json = renderJson([]);
    const parsed = JSON.parse(json) as KnowledgeEntry[];
    expect(parsed).toHaveLength(0);
  });
});

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: 'stark-picking',
    name: 'Stark Dashboard',
    state: {
      phase: 'server-setup',
      active: 'M2 app installation',
      blocked: 'none',
      next: 'IaC backport',
    },
    areas: ['stark', 'infra-vm'],
    links: { jira: 'STARK-653', wiki: 'https://wiki.example.com' },
    artifacts: [
      { id: 'abc12345', filename: 'docs/server-inventory.md', type: 'design', description: 'VM specs and IPs' },
      { id: 'def67890', filename: 'backlog/items.md', type: 'other', description: '' },
    ],
    created: '2026-03-14T00:00:00.000Z',
    updated: '2026-03-15T00:00:00.000Z',
    ...overrides,
  };
}

describe('renderWorkspace', () => {
  it('renders workspace header with name and id', () => {
    const ws = makeWorkspace();
    const journal: JournalEntry[] = [];
    const output = renderWorkspace(ws, journal);
    expect(output).toContain('# Stark Dashboard (stark-picking)');
  });

  it('renders state fields', () => {
    const ws = makeWorkspace();
    const output = renderWorkspace(ws, []);
    expect(output).toContain('Phase: server-setup');
    expect(output).toContain('Active: M2 app installation');
    expect(output).toContain('Blocked: none');
    expect(output).toContain('Next: IaC backport');
  });

  it('renders areas', () => {
    const ws = makeWorkspace();
    const output = renderWorkspace(ws, []);
    expect(output).toContain('Areas: stark, infra-vm');
  });

  it('renders links', () => {
    const ws = makeWorkspace();
    const output = renderWorkspace(ws, []);
    expect(output).toContain('JIRA STARK-653');
    expect(output).toContain('Wiki: https://wiki.example.com');
  });

  it('renders artifacts with id, type, filename, and description', () => {
    const ws = makeWorkspace();
    const output = renderWorkspace(ws, []);
    expect(output).toContain('Artifacts:');
    // Each line has id, type (padded), filename, description
    expect(output).toContain('abc12345');
    expect(output).toContain('design');
    expect(output).toContain('docs/server-inventory.md');
    expect(output).toContain('VM specs and IPs');
    expect(output).toContain('def67890');
    expect(output).toContain('backlog/items.md');
  });

  it('renders artifact with empty description without trailing dash', () => {
    const ws = makeWorkspace({
      artifacts: [{ id: 'xyz00001', filename: 'notes.md', type: 'other', description: '' }],
    });
    const output = renderWorkspace(ws, []);
    expect(output).toContain('xyz00001');
    expect(output).toContain('notes.md');
    expect(output).not.toContain('notes.md —');
  });

  it('aligns artifact types in columns', () => {
    const ws = makeWorkspace({
      artifacts: [
        { id: 'aaa00001', filename: 'a-PLAN.md', type: 'plan', description: 'Plan' },
        { id: 'bbb00002', filename: 'b-DESIGN.md', type: 'design', description: 'Design' },
        { id: 'ccc00003', filename: 'c-ANALYSIS.md', type: 'analysis', description: 'Analysis' },
      ],
    });
    const output = renderWorkspace(ws, []);
    const lines = output.split('\n').filter((l) => l.includes('aaa00001') || l.includes('bbb00002') || l.includes('ccc00003'));
    // All type fields should be padded to same width
    const typePositions = lines.map((l) => l.indexOf('plan') !== -1 ? l.indexOf('plan') : l.indexOf('design') !== -1 ? l.indexOf('design') : l.indexOf('analysis'));
    expect(new Set(typePositions).size).toBe(1); // all start at same column
  });

  it('rendered artifacts are LLM-scannable (behavioral)', () => {
    const ws = makeWorkspace();
    const output = renderWorkspace(ws, []);
    // IDs are extractable — 8-char alphanumeric strings on artifact lines
    const artifactLines = output.split('\n').filter((l) => l.match(/^\s+\w{8}\s/));
    expect(artifactLines.length).toBeGreaterThanOrEqual(2);
    // Filenames are readable
    expect(artifactLines.some((l) => l.includes('.md'))).toBe(true);
    // Types provide categorization
    expect(artifactLines.some((l) => l.includes('design') || l.includes('other'))).toBe(true);
  });

  it('renders journal entries', () => {
    const ws = makeWorkspace();
    const journal: JournalEntry[] = [
      { date: '2026-03-14T10:00:00.000Z', text: 'Configured DNS' },
      { date: '2026-03-15T10:00:00.000Z', text: 'Set up CI pipeline' },
    ];
    const output = renderWorkspace(ws, journal);
    expect(output).toContain('## Recent Journal');
    expect(output).toContain('2026-03-14');
    expect(output).toContain('Configured DNS');
    expect(output).toContain('2026-03-15');
    expect(output).toContain('Set up CI pipeline');
  });

  it('renders workspace with empty state', () => {
    const ws = makeWorkspace({ state: {} });
    const output = renderWorkspace(ws, []);
    // Should not contain state line at all when empty
    expect(output).toContain('# Stark Dashboard (stark-picking)');
  });

  it('renders workspace with no artifacts', () => {
    const ws = makeWorkspace({ artifacts: [] });
    const output = renderWorkspace(ws, []);
    expect(output).not.toContain('Artifacts:');
  });

  it('renders workspace with no journal', () => {
    const ws = makeWorkspace();
    const output = renderWorkspace(ws, []);
    expect(output).not.toContain('## Recent Journal');
  });

  it('renders repo paths from links.repos', () => {
    const ws = makeWorkspace({ links: { repos: ['/home/user/GitLab/my-project'] } });
    const output = renderWorkspace(ws, []);
    expect(output).toContain('Repos: /home/user/GitLab/my-project');
  });

  it('renders multiple repo paths', () => {
    const ws = makeWorkspace({
      links: { repos: ['/path/to/repo1', '/path/to/repo2'] },
    });
    const output = renderWorkspace(ws, []);
    expect(output).toContain('Repos: /path/to/repo1, /path/to/repo2');
  });

  it('omits repos line when links.repos is empty', () => {
    const ws = makeWorkspace({ links: { repos: [] } });
    const output = renderWorkspace(ws, []);
    expect(output).not.toContain('Repos:');
  });

  it('omits repos line when links.repos is undefined', () => {
    const ws = makeWorkspace({ links: {} });
    const output = renderWorkspace(ws, []);
    expect(output).not.toContain('Repos:');
  });

  it('renders knowledge area index with summaries and counts', () => {
    const ws = makeWorkspace({ areas: ['vmctl'] });
    const areaContexts: AreaContext[] = [
      {
        id: 'vmctl',
        summary: 'Azure VM power management dashboard',
        stats: { facts: 16, decisions: 14, gotchas: 6, patterns: 2, links: 1 },
      },
    ];
    const output = renderWorkspace(ws, [], areaContexts);
    expect(output).toContain('## Knowledge Areas');
    expect(output).toContain('**vmctl**');
    expect(output).toContain('Azure VM power management dashboard');
    expect(output).toContain('16 facts');
    expect(output).toContain('14 decisions');
    expect(output).toContain('6 gotchas');
    expect(output).toContain('2 patterns');
    expect(output).toContain('1 link');
  });

  it('renders only non-zero entry counts', () => {
    const ws = makeWorkspace({ areas: ['empty-area'] });
    const areaContexts: AreaContext[] = [
      {
        id: 'empty-area',
        summary: 'An area with only facts',
        stats: { facts: 5, decisions: 0, gotchas: 0, patterns: 0, links: 0 },
      },
    ];
    const output = renderWorkspace(ws, [], areaContexts);
    expect(output).toContain('5 facts');
    expect(output).not.toContain('0 decisions');
    expect(output).not.toContain('0 gotchas');
  });

  it('renders nudge instruction after area index', () => {
    const ws = makeWorkspace({ areas: ['vmctl'] });
    const areaContexts: AreaContext[] = [
      {
        id: 'vmctl',
        summary: 'Test',
        stats: { facts: 1, decisions: 0, gotchas: 0, patterns: 0, links: 0 },
      },
    ];
    const output = renderWorkspace(ws, [], areaContexts);
    expect(output).toContain('kb load');
  });

  it('falls back to Areas line when areaContexts not provided', () => {
    const ws = makeWorkspace({ areas: ['stark', 'infra-vm'] });
    const output = renderWorkspace(ws, []);
    expect(output).toContain('Areas: stark, infra-vm');
    expect(output).not.toContain('## Knowledge Areas');
  });

  it('falls back to Areas line when areaContexts is empty array', () => {
    const ws = makeWorkspace({ areas: ['stark', 'infra-vm'] });
    const output = renderWorkspace(ws, [], []);
    expect(output).toContain('Areas: stark, infra-vm');
    expect(output).not.toContain('## Knowledge Areas');
  });

  it('knowledge area index is LLM-scannable (behavioral)', () => {
    const ws = makeWorkspace({ areas: ['vmctl', 'infra-net'] });
    const areaContexts: AreaContext[] = [
      {
        id: 'vmctl',
        summary: 'Azure VM power management dashboard',
        stats: { facts: 16, decisions: 14, gotchas: 6, patterns: 2, links: 1 },
      },
      {
        id: 'infra-net',
        summary: 'Azure networking and WireGuard VPN',
        stats: { facts: 8, decisions: 3, gotchas: 2, patterns: 0, links: 0 },
      },
    ];
    const output = renderWorkspace(ws, [], areaContexts);

    // Area IDs are extractable (bold markdown)
    const areaIdMatches = output.match(/\*\*(\w[\w-]*)\*\*/g);
    expect(areaIdMatches).toBeTruthy();
    expect(areaIdMatches!.length).toBe(2);

    // Summaries are readable alongside IDs
    expect(output).toContain('**vmctl**: Azure VM power management dashboard');
    expect(output).toContain('**infra-net**: Azure networking and WireGuard VPN');

    // Gotcha counts are visible (key nudge signal)
    expect(output).toContain('6 gotchas');
    expect(output).toContain('2 gotchas');

    // Load instruction is present and actionable
    expect(output).toMatch(/kb load/);
  });

  it('renders sections in correct order: repos → state → areas → artifacts → journal', () => {
    const ws = makeWorkspace({
      links: { repos: ['/path/to/repo'], jira: 'PROJ-1' },
    });
    const areaContexts: AreaContext[] = [
      {
        id: 'stark',
        summary: 'Test area',
        stats: { facts: 1, decisions: 0, gotchas: 0, patterns: 0, links: 0 },
      },
    ];
    const journal: JournalEntry[] = [
      { date: '2026-03-15T00:00:00.000Z', text: 'Did something' },
    ];
    const output = renderWorkspace(ws, journal, areaContexts);

    const reposPos = output.indexOf('Repos:');
    const statePos = output.indexOf('Phase:');
    const areasPos = output.indexOf('## Knowledge Areas');
    const artifactsPos = output.indexOf('Artifacts:');
    const journalPos = output.indexOf('## Recent Journal');

    expect(reposPos).toBeLessThan(statePos);
    expect(statePos).toBeLessThan(areasPos);
    expect(areasPos).toBeLessThan(artifactsPos);
    expect(artifactsPos).toBeLessThan(journalPos);
  });

  describe('handoff rendering', () => {
    it('renders Resume section with date when handoff is provided', () => {
      const ws = makeWorkspace();
      const handoff: HandoffData = {
        text: 'Working on step 3. Next: write tests.',
        updated: '2026-03-22T14:30:00.000Z',
      };
      const output = renderWorkspace(ws, [], undefined, handoff);
      expect(output).toContain('## Resume (2026-03-22)');
      expect(output).toContain('Working on step 3. Next: write tests.');
    });

    it('does not render Resume section when no handoff', () => {
      const ws = makeWorkspace();
      const output = renderWorkspace(ws, [], undefined, null);
      expect(output).not.toContain('## Resume');
    });

    it('does not render Resume section when handoff is undefined', () => {
      const ws = makeWorkspace();
      const output = renderWorkspace(ws, []);
      expect(output).not.toContain('## Resume');
    });

    it('renders handoff before state fields', () => {
      const ws = makeWorkspace();
      const handoff: HandoffData = {
        text: 'Handoff content here.',
        updated: '2026-03-22T14:30:00.000Z',
      };
      const output = renderWorkspace(ws, [], undefined, handoff);
      const resumePos = output.indexOf('## Resume');
      const statePos = output.indexOf('Phase:');
      expect(resumePos).toBeGreaterThan(-1);
      expect(statePos).toBeGreaterThan(-1);
      expect(resumePos).toBeLessThan(statePos);
    });

    it('marks handoff as possibly outdated when journal is newer', () => {
      const ws = makeWorkspace();
      const handoff: HandoffData = {
        text: 'Old handoff.',
        updated: '2026-03-20T10:00:00.000Z',
      };
      const journal: JournalEntry[] = [
        { date: '2026-03-21T10:00:00.000Z', text: 'Newer work happened' },
      ];
      const output = renderWorkspace(ws, journal, undefined, handoff);
      expect(output).toContain('## Resume (2026-03-20, may be outdated)');
    });

    it('does not mark handoff as outdated when it is newer than journal', () => {
      const ws = makeWorkspace();
      const handoff: HandoffData = {
        text: 'Fresh handoff.',
        updated: '2026-03-22T14:30:00.000Z',
      };
      const journal: JournalEntry[] = [
        { date: '2026-03-21T10:00:00.000Z', text: 'Older work' },
      ];
      const output = renderWorkspace(ws, journal, undefined, handoff);
      expect(output).toContain('## Resume (2026-03-22)');
      expect(output).not.toContain('may be outdated');
    });

    it('renders multi-line handoff text', () => {
      const ws = makeWorkspace();
      const handoff: HandoffData = {
        text: 'Line 1: doing X.\nLine 2: next Y.\nLine 3: blocked on Z.',
        updated: '2026-03-22T14:30:00.000Z',
      };
      const output = renderWorkspace(ws, [], undefined, handoff);
      expect(output).toContain('Line 1: doing X.');
      expect(output).toContain('Line 2: next Y.');
      expect(output).toContain('Line 3: blocked on Z.');
    });

    it('renders full section order: resume → repos → state → areas → artifacts → journal', () => {
      const ws = makeWorkspace({
        links: { repos: ['/path/to/repo'], jira: 'PROJ-1' },
      });
      const areaContexts: AreaContext[] = [
        {
          id: 'stark',
          summary: 'Test area',
          stats: { facts: 1, decisions: 0, gotchas: 0, patterns: 0, links: 0 },
        },
      ];
      const journal: JournalEntry[] = [
        { date: '2026-03-15T00:00:00.000Z', text: 'Did something' },
      ];
      const handoff: HandoffData = {
        text: 'Resume context.',
        updated: '2026-03-22T00:00:00.000Z',
      };
      const output = renderWorkspace(ws, journal, areaContexts, handoff);

      const resumePos = output.indexOf('## Resume');
      const reposPos = output.indexOf('Repos:');
      const statePos = output.indexOf('Phase:');
      const areasPos = output.indexOf('## Knowledge Areas');
      const artifactsPos = output.indexOf('Artifacts:');
      const journalPos = output.indexOf('## Recent Journal');

      expect(resumePos).toBeLessThan(reposPos);
      expect(reposPos).toBeLessThan(statePos);
      expect(statePos).toBeLessThan(areasPos);
      expect(areasPos).toBeLessThan(artifactsPos);
      expect(artifactsPos).toBeLessThan(journalPos);
    });
  });
});
