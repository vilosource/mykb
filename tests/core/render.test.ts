import { describe, it, expect } from 'vitest';
import {
  renderMarkdown,
  renderContextBlock,
  renderAreaIndex,
  renderJson,
} from '../../src/core/render.js';
import type { KnowledgeEntry, AreaMetadata } from '../../src/core/types.js';
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
