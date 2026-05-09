import { describe, it, expect } from 'vitest';
import { filterRecentJournal, cutoffForDays } from '../../src/core/journal-window.js';
import type { JournalEntry } from '../../src/core/types.js';

function entry(date: string, text: string): JournalEntry {
  return { date, text };
}

describe('filterRecentJournal', () => {
  it('keeps entries with date >= cutoff', () => {
    const entries = [
      entry('2026-05-05T10:00:00.000Z', 'old'),
      entry('2026-05-08T10:00:00.000Z', 'recent'),
      entry('2026-05-09T10:00:00.000Z', 'newest'),
    ];
    const out = filterRecentJournal(entries, '2026-05-08T00:00:00.000Z', 20);
    expect(out).toHaveLength(2);
    expect(out[0].text).toBe('recent');
    expect(out[1].text).toBe('newest');
  });

  it('treats cutoff as inclusive', () => {
    const entries = [entry('2026-05-08T00:00:00.000Z', 'on-cutoff')];
    const out = filterRecentJournal(entries, '2026-05-08T00:00:00.000Z', 20);
    expect(out).toHaveLength(1);
  });

  it('returns the newest maxEntries when more pass the filter', () => {
    const entries: JournalEntry[] = [];
    for (let i = 0; i < 30; i++) {
      entries.push(entry(`2026-05-09T${String(i).padStart(2, '0')}:00:00.000Z`, `e${i}`));
    }
    const out = filterRecentJournal(entries, '2026-05-08T00:00:00.000Z', 20);
    expect(out).toHaveLength(20);
    // Tail-slice keeps newest; oldest of returned set is e10
    expect(out[0].text).toBe('e10');
    expect(out[19].text).toBe('e29');
  });

  it('preserves chronological order of returned entries', () => {
    const entries = [
      entry('2026-05-08T10:00:00.000Z', 'first'),
      entry('2026-05-09T10:00:00.000Z', 'second'),
      entry('2026-05-09T11:00:00.000Z', 'third'),
    ];
    const out = filterRecentJournal(entries, '2026-05-08T00:00:00.000Z', 20);
    expect(out.map((e) => e.text)).toEqual(['first', 'second', 'third']);
  });

  it('returns empty array when no entries pass the filter', () => {
    const entries = [entry('2026-05-01T10:00:00.000Z', 'ancient')];
    const out = filterRecentJournal(entries, '2026-05-08T00:00:00.000Z', 20);
    expect(out).toEqual([]);
  });

  it('returns empty array when entries is empty', () => {
    const out = filterRecentJournal([], '2026-05-08T00:00:00.000Z', 20);
    expect(out).toEqual([]);
  });

  it('returns empty array when maxEntries is 0', () => {
    const entries = [entry('2026-05-09T10:00:00.000Z', 'recent')];
    const out = filterRecentJournal(entries, '2026-05-08T00:00:00.000Z', 0);
    expect(out).toEqual([]);
  });
});

describe('cutoffForDays', () => {
  it('subtracts the requested number of days from `now`', () => {
    const now = new Date('2026-05-09T12:00:00.000Z');
    expect(cutoffForDays(2, now)).toBe('2026-05-07T12:00:00.000Z');
  });

  it('handles zero days (cutoff equals now)', () => {
    const now = new Date('2026-05-09T12:00:00.000Z');
    expect(cutoffForDays(0, now)).toBe('2026-05-09T12:00:00.000Z');
  });

  it('uses real Date.now when no `now` is supplied', () => {
    const before = Date.now();
    const cutoff = cutoffForDays(1);
    const after = Date.now();
    const cutoffMs = new Date(cutoff).getTime();
    expect(cutoffMs).toBeGreaterThanOrEqual(before - 86_400_000);
    expect(cutoffMs).toBeLessThanOrEqual(after - 86_400_000);
  });
});
