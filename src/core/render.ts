import type { KnowledgeEntry, AreaMetadata, Workspace, JournalEntry, AreaContext } from './types.js';
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

export function renderWorkspace(
  workspace: Workspace,
  journalEntries: JournalEntry[],
  areaContexts?: AreaContext[],
): string {
  const lines: string[] = [];

  lines.push(`# ${workspace.name} (${workspace.id})`);

  // Repos
  if (workspace.links.repos && workspace.links.repos.length > 0) {
    lines.push(`Repos: ${workspace.links.repos.join(', ')}`);
  }

  // State line
  const stateFields: string[] = [];
  if (workspace.state.phase !== undefined) stateFields.push(`Phase: ${workspace.state.phase}`);
  if (workspace.state.active !== undefined) stateFields.push(`Active: ${workspace.state.active}`);
  if (workspace.state.blocked !== undefined) stateFields.push(`Blocked: ${workspace.state.blocked}`);
  if (workspace.state.next !== undefined) stateFields.push(`Next: ${workspace.state.next}`);
  if (stateFields.length > 0) {
    lines.push(stateFields.join(' | '));
  }

  // Knowledge area index (with context) or fallback to simple area list
  if (areaContexts && areaContexts.length > 0) {
    lines.push('');
    lines.push('## Knowledge Areas');
    for (const ctx of areaContexts) {
      const counts = formatStatsCounts(ctx.stats);
      const countsSuffix = counts ? ` — ${counts}` : '';
      lines.push(`- **${ctx.id}**: ${ctx.summary}${countsSuffix}`);
    }
    lines.push('Run `kb load <id>` for full context before starting work.');
  } else if (workspace.areas.length > 0) {
    lines.push(`Areas: ${workspace.areas.join(', ')}`);
  }

  // Links
  const linkParts: string[] = [];
  if (workspace.links.jira) linkParts.push(`JIRA ${workspace.links.jira}`);
  if (workspace.links.wiki) linkParts.push(`Wiki: ${workspace.links.wiki}`);
  if (linkParts.length > 0) {
    lines.push(`Links: ${linkParts.join(' | ')}`);
  }

  // Artifacts
  if (workspace.artifacts.length > 0) {
    lines.push('Artifacts:');
    const maxType = Math.max(...workspace.artifacts.map((a) => a.type.length));
    for (const a of workspace.artifacts) {
      const typePadded = a.type.padEnd(maxType);
      if (a.description) {
        lines.push(`  ${a.id}  ${typePadded}  ${a.filename} — ${a.description}`);
      } else {
        lines.push(`  ${a.id}  ${typePadded}  ${a.filename}`);
      }
    }
  }

  // Journal
  if (journalEntries.length > 0) {
    lines.push('');
    lines.push('## Recent Journal');
    for (const entry of journalEntries) {
      const dateStr = entry.date.split('T')[0];
      lines.push(`- ${dateStr}: ${entry.text}`);
    }
  }

  return lines.join('\n') + '\n';
}

function formatStatsCounts(stats: AreaContext['stats']): string {
  const parts: string[] = [];
  if (stats.facts > 0) parts.push(`${stats.facts} fact${stats.facts !== 1 ? 's' : ''}`);
  if (stats.decisions > 0) parts.push(`${stats.decisions} decision${stats.decisions !== 1 ? 's' : ''}`);
  if (stats.gotchas > 0) parts.push(`${stats.gotchas} gotcha${stats.gotchas !== 1 ? 's' : ''}`);
  if (stats.patterns > 0) parts.push(`${stats.patterns} pattern${stats.patterns !== 1 ? 's' : ''}`);
  if (stats.links > 0) parts.push(`${stats.links} link${stats.links !== 1 ? 's' : ''}`);
  return parts.join(', ');
}
