import { type AreaMetadata, type KnowledgeEntry, Zone } from '../core/types.js';
import type { MykbStore } from '../core/knowledge-store.js';
import type { Signal } from './state.js';

export type ScoreResult = {
  area: string;
  score: number;
};

export interface SignalProvider {
  name: string;
  score(signal: Signal, areas: AreaMetadata[]): ScoreResult[];
}

/**
 * Tokenize a string into lowercase words, stripping punctuation.
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1);
}

/**
 * Compute word overlap score between a set of query words and target text + tags.
 */
function wordOverlap(queryWords: string[], summary: string, tags: string[]): number {
  const targetWords = new Set([...tokenize(summary), ...tags.map((t) => t.toLowerCase())]);
  let matches = 0;
  for (const word of queryWords) {
    if (targetWords.has(word)) {
      matches++;
    }
  }
  return matches;
}

/**
 * KeywordSignalProvider — matches signal value against area summaries and tags
 * using simple word overlap.
 */
export class KeywordSignalProvider implements SignalProvider {
  name = 'keyword';

  score(signal: Signal, areas: AreaMetadata[]): ScoreResult[] {
    const words = tokenize(signal.value);
    if (words.length === 0) return [];

    const results: ScoreResult[] = [];
    for (const area of areas) {
      const overlap = wordOverlap(words, area.summary, area.tags);
      if (overlap > 0) {
        results.push({ area: area.id, score: overlap });
      }
    }
    return results;
  }
}

/**
 * FilePathSignalProvider — extracts keywords from file paths and scores areas.
 */
export class FilePathSignalProvider implements SignalProvider {
  name = 'file_path';

  score(signal: Signal, areas: AreaMetadata[]): ScoreResult[] {
    // Extract meaningful parts from file path
    const parts = signal.value.split(/[/\\.]/).filter((p) => p.length > 1);
    const words = parts.flatMap((p) => tokenize(p));

    if (words.length === 0) return [];

    const results: ScoreResult[] = [];
    for (const area of areas) {
      const overlap = wordOverlap(words, area.summary, area.tags);
      if (overlap > 0) {
        results.push({ area: area.id, score: overlap });
      }
    }
    return results;
  }
}

const WORKSPACE_BOOST = 0.5;

/**
 * Score areas based on accumulated signals from multiple providers.
 * Returns a map of area ID to aggregated score.
 * Areas in boostedAreas (from active workspace) get a base score boost.
 */
export function scoreAreas(
  signals: Signal[],
  providers: SignalProvider[],
  areas: AreaMetadata[],
  _store: MykbStore,
  boostedAreas?: Set<string>,
): Map<string, number> {
  // _store reserved for future FTS5-based deep matching
  void _store;
  const scores = new Map<string, number>();

  for (const signal of signals) {
    for (const provider of providers) {
      const results = provider.score(signal, areas);
      for (const result of results) {
        const current = scores.get(result.area) ?? 0;
        scores.set(result.area, current + result.score);
      }
    }
  }

  // Apply workspace boost to linked areas
  if (boostedAreas && boostedAreas.size > 0) {
    for (const area of areas) {
      if (boostedAreas.has(area.id)) {
        const current = scores.get(area.id) ?? 0;
        scores.set(area.id, current + WORKSPACE_BOOST);
      }
    }
  }

  return scores;
}

const STICKY_BOOST = 2;

/**
 * Select knowledge entries for injection, respecting token budget.
 * Already-loaded areas get a small score boost (sticky areas).
 * Token estimation: text.length / 4.
 */
export function selectEntriesForInjection(
  scoredAreas: Map<string, number>,
  store: MykbStore,
  tokenBudget: number,
  loadedAreas: Set<string>,
): Map<string, KnowledgeEntry[]> {
  const result = new Map<string, KnowledgeEntry[]>();

  if (scoredAreas.size === 0) return result;

  // Apply sticky boost and sort by score descending
  const boosted: Array<{ area: string; score: number }> = [];
  for (const [area, score] of scoredAreas) {
    const boost = loadedAreas.has(area) ? STICKY_BOOST : 0;
    boosted.push({ area, score: score + boost });
  }
  boosted.sort((a, b) => b.score - a.score);

  let tokensUsed = 0;

  for (const { area } of boosted) {
    if (tokensUsed >= tokenBudget) break;

    const entries = store.loadArea(area, { excludeZone: Zone.Archive });
    if (entries.length === 0) continue;

    const areaEntries: KnowledgeEntry[] = [];
    for (const entry of entries) {
      const entryTokens = entry.text.length / 4;
      if (tokensUsed + entryTokens > tokenBudget && areaEntries.length > 0) {
        break;
      }
      areaEntries.push(entry);
      tokensUsed += entryTokens;
    }

    if (areaEntries.length > 0) {
      result.set(area, areaEntries);
    }
  }

  return result;
}
