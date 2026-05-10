import type { JournalEntry } from './types.js';

/**
 * Select journal entries within a recent time window, capped at a maximum count.
 *
 * Pure function: `cutoffISO` is the lower bound (inclusive); entries with
 * `date >= cutoffISO` pass the filter. From the surviving entries, the newest
 * `maxEntries` are returned in original (chronological) order.
 *
 * Assumes `entries` is in chronological order — the contract guaranteed by
 * `FileSystemWorkspaceStorage.readJournal` (append-only journal.jsonl).
 */
export function filterRecentJournal(
  entries: JournalEntry[],
  cutoffISO: string,
  maxEntries: number,
): JournalEntry[] {
  const recent = entries.filter((e) => e.date >= cutoffISO);
  if (maxEntries <= 0) return [];
  return recent.slice(-maxEntries);
}

/**
 * Compute the ISO cutoff string for "now minus `days` days".
 *
 * Extracted as a helper so callers can pass it to `filterRecentJournal` while
 * keeping the filter itself a pure function of inputs (no `Date.now()` inside).
 */
export function cutoffForDays(days: number, now: Date = new Date()): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}
