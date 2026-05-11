import type { WorkspaceStorage } from './types.js';
import { listAreas } from './area.js';
import { readAllEntries } from './store.js';
import { cutoffForDays } from './journal-window.js';

/** A workspace that has activity within the requested window. */
export interface RecentWorkspace {
  id: string;
  name: string;
  /** `state.phase`, if set. */
  phase?: string;
  /** True iff this is the currently-active workspace (`getActiveWorkspaceId()`). */
  active: boolean;
  /** ISO — `max(workspace.updated, latest journal date, max note date, handoff updated)`. */
  lastActivity: string;
  /** Journal entries with `date >= since`. */
  journalCount: number;
  /** Resolved notes with `date >= since`. */
  noteCount: number;
  /**
   * In-window journal entry texts, newest first. The renderer shows the first
   * one as the "what was it about" line (or all of them under `--full`).
   * Empty when there's no in-window journal entry.
   */
  journalLines: string[];
  /**
   * One-liner shown when `journalLines` is empty: the handoff's first non-empty
   * line → `state.active` → `state.next` → `''`.
   */
  fallbackSummary: string;
}

/** An area whose resolved entries include one updated within the window. */
export interface RecentArea {
  id: string;
  /** Resolved entries with `updated >= since`. */
  entryCount: number;
  /** ISO — newest `updated` among that area's resolved entries. */
  lastUpdated: string;
}

export interface RecentActivity {
  /** ISO cutoff applied; `''` when `all` is set (no window). */
  since: string;
  /** ISO — when this digest was computed. */
  generatedAt: string;
  /** True when the time window was disabled (`--all`). */
  all: boolean;
  /** Workspaces with in-window activity, newest `lastActivity` first. */
  workspaces: RecentWorkspace[];
  /** Areas with in-window entry activity, newest `lastUpdated` first. */
  areas: RecentArea[];
}

export interface RecentOptions {
  /** Explicit ISO cutoff (date `YYYY-MM-DD` or full timestamp). Overrides `days`. */
  since?: string;
  /** Window = "now − `days` days". Default 2. Ignored when `since` or `all` is set. */
  days?: number;
  /** Ignore the window — include every (non-archived) workspace and any area with entries. */
  all?: boolean;
  /** Injectable clock for tests. */
  now?: Date;
}

const DEFAULT_DAYS = 2;

function maxIso(...values: Array<string | undefined>): string {
  let best = '';
  for (const v of values) {
    if (v && v > best) best = v;
  }
  return best;
}

function firstNonEmptyLine(text: string | undefined): string {
  if (!text) return '';
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (t) return t;
  }
  return '';
}

/** Journal entries logged as just "-" (or blank) are placeholders — not worth showing as a summary. */
function isTrivialJournalText(text: string): boolean {
  const t = text.trim();
  return t === '' || t === '-';
}

/**
 * Build a cross-workspace / cross-area "recent activity" digest.
 *
 * Pure read: scans the workspace storage and the on-disk area JSONL — no
 * SQLite, no git, no network. The `--git` view (commit log) is layered on by
 * the CLI, not here, so this stays trivially testable with `withTempBrain`.
 *
 * "Last activity" for a workspace is the max of its `workspace.json.updated`,
 * its newest journal entry's `date`, its newest note's `date`, and its handoff
 * `updated` — `workspace.json.updated` alone is a poor proxy (journal/handoff
 * don't bump it). All comparisons use the stored ISO strings (clone-stable),
 * never file mtimes.
 */
export function getRecentActivity(
  brainPath: string,
  wsStorage: WorkspaceStorage,
  opts: RecentOptions = {},
): RecentActivity {
  const now = opts.now ?? new Date();
  const all = opts.all === true;
  const since = all ? '' : (opts.since ?? cutoffForDays(opts.days ?? DEFAULT_DAYS, now));
  const passesWindow = (iso: string): boolean => all || (iso !== '' && iso >= since);

  const activeId = wsStorage.getActiveWorkspaceId();

  // ── Workspaces ────────────────────────────────────────────────
  const workspaces: RecentWorkspace[] = [];
  for (const ws of wsStorage.listWorkspaces()) {
    const journal = wsStorage.readJournal(ws.id); // chronological (append-only)
    const notes = wsStorage.readNotes(ws.id); // tombstones already resolved
    const handoff = wsStorage.readHandoff(ws.id);

    const newestJournalDate = journal.length > 0 ? journal[journal.length - 1].date : '';
    const newestNoteDate = maxIso(...notes.map((n) => n.date));
    const lastActivity = maxIso(ws.updated, newestJournalDate, newestNoteDate, handoff?.updated);
    if (!passesWindow(lastActivity)) continue;

    const inWindowJournal = journal.filter((e) => passesWindow(e.date));
    const inWindowNotes = notes.filter((n) => passesWindow(n.date));
    // Newest first for the renderer; drop "-"/blank placeholder entries from
    // the summary lines (they still count toward journalCount).
    const journalLines = inWindowJournal
      .filter((e) => !isTrivialJournalText(e.text))
      .map((e) => e.text)
      .reverse();

    // Fallback "what was this about" when there's no usable in-window journal
    // line: the handoff's first line → the newest non-trivial journal entry of
    // any date → state.active → state.next.
    const newestMeaningfulJournal = [...journal]
      .reverse()
      .find((e) => !isTrivialJournalText(e.text))?.text;
    const fallbackSummary =
      firstNonEmptyLine(handoff?.text) ||
      newestMeaningfulJournal ||
      ws.state.active ||
      ws.state.next ||
      '';

    workspaces.push({
      id: ws.id,
      name: ws.name,
      phase: ws.state.phase,
      active: activeId !== null && ws.id === activeId,
      lastActivity,
      journalCount: inWindowJournal.length,
      noteCount: inWindowNotes.length,
      journalLines,
      fallbackSummary,
    });
  }
  workspaces.sort((a, b) =>
    a.lastActivity < b.lastActivity
      ? 1
      : a.lastActivity > b.lastActivity
        ? -1
        : a.id < b.id
          ? -1
          : 1,
  );

  // ── Areas ─────────────────────────────────────────────────────
  const areas: RecentArea[] = [];
  for (const area of listAreas(brainPath)) {
    const entries = readAllEntries(brainPath, area.id); // tombstones resolved
    let count = 0;
    let lastUpdated = '';
    for (const e of entries) {
      if (passesWindow(e.updated)) {
        count += 1;
        if (e.updated > lastUpdated) lastUpdated = e.updated;
      }
    }
    if (count === 0) continue;
    areas.push({ id: area.id, entryCount: count, lastUpdated });
  }
  areas.sort((a, b) =>
    a.lastUpdated < b.lastUpdated ? 1 : a.lastUpdated > b.lastUpdated ? -1 : a.id < b.id ? -1 : 1,
  );

  return { since, generatedAt: now.toISOString(), all, workspaces, areas };
}

// ─────────────────────────────────────────────────────────────────
// Rendering
// ─────────────────────────────────────────────────────────────────

export interface RenderRecentOptions {
  /** Per workspace, show up to 5 in-window journal lines instead of just the latest. */
  full?: boolean;
  /** Width to wrap/truncate journal lines to. Default 96. */
  width?: number;
  /** Clock for the relative-time strings. Defaults to `activity.generatedAt`. */
  now?: Date;
}

const ONELINER_DEFAULT_WIDTH = 96;
const FULL_JOURNAL_MAX_LINES = 5;

/** Single-line, length-capped: collapse whitespace, hard-truncate with an ellipsis. */
function oneLine(text: string, width: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= width) return collapsed;
  return collapsed.slice(0, Math.max(0, width - 1)).trimEnd() + '…';
}

function relativeTime(iso: string, now: Date): string {
  if (!iso) return 'unknown';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const deltaMs = now.getTime() - then;
  if (deltaMs < 0) return 'just now';
  const mins = Math.floor(deltaMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 8) return `${weeks}w ago`;
  return iso.slice(0, 10);
}

function pluralEntries(n: number): string {
  return `${n} ${n === 1 ? 'entry' : 'entries'}`;
}

/** Render a `RecentActivity` as the human-readable digest `kb recent` prints. */
export function renderRecent(activity: RecentActivity, opts: RenderRecentOptions = {}): string {
  const width = opts.width ?? ONELINER_DEFAULT_WIDTH;
  const now = opts.now ?? new Date(activity.generatedAt);
  const lines: string[] = [];

  const header = activity.all
    ? 'Recent activity — all (no time window)'
    : `Recent activity — since ${activity.since.slice(0, 10)}`;
  lines.push(header, '');

  // Workspaces.
  if (activity.workspaces.length === 0) {
    lines.push('WORKSPACES', '  (none)');
  } else {
    lines.push('WORKSPACES');
    const idWidth = Math.min(20, Math.max(...activity.workspaces.map((w) => w.id.length)));
    for (const w of activity.workspaces) {
      const marker = w.active ? '*' : ' ';
      const count = activity.all ? '' : `${pluralEntries(w.journalCount + w.noteCount).padEnd(12)}`;
      const rel = relativeTime(w.lastActivity, now);
      const phase = w.phase ? `${w.phase}` : '';
      lines.push(
        `${marker} ${w.id.padEnd(idWidth)}  ${rel.padEnd(11)}  ${count}${phase}`.trimEnd(),
      );
      const journalToShow = opts.full
        ? w.journalLines.slice(0, FULL_JOURNAL_MAX_LINES)
        : w.journalLines.slice(0, 1);
      if (journalToShow.length > 0) {
        for (const text of journalToShow) {
          lines.push(`    └ ${oneLine(text, width)}`);
        }
      } else if (w.fallbackSummary) {
        lines.push(`    └ ${oneLine(w.fallbackSummary, width)}`);
      }
    }
  }

  lines.push('');

  // Areas.
  if (activity.areas.length === 0) {
    lines.push('AREAS', '  (none)');
  } else {
    lines.push('AREAS');
    const idWidth = Math.min(20, Math.max(...activity.areas.map((a) => a.id.length)));
    for (const a of activity.areas) {
      const count = pluralEntries(a.entryCount);
      lines.push(
        `  ${a.id.padEnd(idWidth)}  ${count.padEnd(11)}(last ${a.lastUpdated.slice(0, 16).replace('T', ' ')})`,
      );
    }
  }

  if (activity.workspaces.length === 0 && activity.areas.length === 0) {
    return `${header}\n\n  (no recent activity)\n`;
  }

  return lines.join('\n') + '\n';
}
