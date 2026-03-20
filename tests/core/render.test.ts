import { describe, it, expect } from 'vitest';
import {
  renderMarkdown,
  renderContextBlock,
  renderAreaIndex,
  renderJson,
  renderWorkspace,
} from '../../src/core/render.js';
import type { KnowledgeEntry, AreaMetadata, Workspace, JournalEntry } from '../../src/core/types.js';
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
});
