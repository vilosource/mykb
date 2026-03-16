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
    documents: [
      { path: 'docs/server-inventory.md', description: 'VM specs and IPs' },
      { path: 'backlog/items.md', description: null },
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

  it('renders documents with descriptions', () => {
    const ws = makeWorkspace();
    const output = renderWorkspace(ws, []);
    expect(output).toContain('docs/server-inventory.md');
    expect(output).toContain('VM specs and IPs');
    expect(output).toContain('backlog/items.md');
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

  it('renders workspace with no documents', () => {
    const ws = makeWorkspace({ documents: [] });
    const output = renderWorkspace(ws, []);
    expect(output).not.toContain('Documents:');
  });

  it('renders workspace with no journal', () => {
    const ws = makeWorkspace();
    const output = renderWorkspace(ws, []);
    expect(output).not.toContain('## Recent Journal');
  });
});
