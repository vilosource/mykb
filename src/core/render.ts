import type { KnowledgeEntry, AreaMetadata } from './types.js';
import { ProvenanceStatus } from './types.js';

function capitalizeZone(zone: string): string {
  return zone.charAt(0).toUpperCase() + zone.slice(1);
}

function renderEntryLine(entry: KnowledgeEntry): string {
  let line = `- ${entry.text}`;

  if (entry.tags.length > 0) {
    line += ' ' + entry.tags.map((t) => `#${t}`).join(' ');
  }

  if (entry.provenance.status === ProvenanceStatus.Verified && entry.provenance.date) {
    line += ` (verified:${entry.provenance.date})`;
  }

  return line;
}

function groupByArea(entries: KnowledgeEntry[]): Map<string, KnowledgeEntry[]> {
  const groups = new Map<string, KnowledgeEntry[]>();
  for (const entry of entries) {
    const list = groups.get(entry.area) ?? [];
    list.push(entry);
    groups.set(entry.area, list);
  }
  return groups;
}

export function renderMarkdown(entries: KnowledgeEntry[]): string {
  if (entries.length === 0) return '';

  const grouped = groupByArea(entries);
  const sections: string[] = [];

  for (const [area, areaEntries] of grouped) {
    const zone = capitalizeZone(areaEntries[0].zone);
    const lines = [`## ${area} (${zone})`];
    for (const entry of areaEntries) {
      lines.push(renderEntryLine(entry));
    }
    sections.push(lines.join('\n'));
  }

  return sections.join('\n\n') + '\n';
}

export function renderContextBlock(areaEntries: Map<string, KnowledgeEntry[]>): string {
  const innerParts: string[] = [];

  for (const [area, entries] of areaEntries) {
    const lines = [`## ${area}`];
    for (const entry of entries) {
      lines.push(renderEntryLine(entry));
    }
    innerParts.push(lines.join('\n'));
  }

  const inner = innerParts.length > 0 ? '\n' + innerParts.join('\n\n') + '\n' : '\n';
  return `<mykb-context>${inner}</mykb-context>\n`;
}

export function renderAreaIndex(areas: AreaMetadata[]): string {
  if (areas.length === 0) return '';

  const lines: string[] = [];
  for (const area of areas) {
    lines.push(`- **${area.id}**: ${area.summary}`);
  }
  return lines.join('\n') + '\n';
}

export function renderJson(entries: KnowledgeEntry[]): string {
  return JSON.stringify(entries, null, 2);
}
