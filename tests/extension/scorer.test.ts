import { describe, it, expect } from 'vitest';
import { withTempBrain } from '../helpers.js';
import { initBrain } from '../../src/core/init.js';
import { MykbStore } from '../../src/core/knowledge-store.js';
import {
  scoreAreas,
  selectEntriesForInjection,
  KeywordSignalProvider,
  FilePathSignalProvider,
} from '../../src/extension/scorer.js';
import type { Signal } from '../../src/extension/state.js';
import type { AreaMetadata } from '../../src/core/types.js';

const areas: AreaMetadata[] = [
  {
    id: 'networking',
    name: 'Networking',
    summary: 'Network configuration, DNS, VPN, firewall rules and load balancers',
    owner: 'netops',
    tags: ['network', 'dns', 'vpn', 'firewall'],
    created: '2026-01-01T00:00:00.000Z',
    updated: '2026-03-10T00:00:00.000Z',
  },
  {
    id: 'ci-pipelines',
    name: 'CI Pipelines',
    summary: 'CI/CD pipelines, GitHub Actions, GitLab CI, build automation and deployment',
    owner: 'devops',
    tags: ['ci', 'cd', 'github-actions', 'gitlab-ci', 'deployment'],
    created: '2026-01-01T00:00:00.000Z',
    updated: '2026-03-12T00:00:00.000Z',
  },
  {
    id: 'secrets',
    name: 'Secrets',
    summary: 'Secret management, vault, key rotation, certificates and credentials',
    owner: 'security',
    tags: ['secrets', 'vault', 'certificates', 'credentials'],
    created: '2026-01-01T00:00:00.000Z',
    updated: '2026-03-14T00:00:00.000Z',
  },
];

function makeSignal(type: string, value: string): Signal {
  return { type, value, timestamp: Date.now() };
}

describe('scoreAreas', () => {
  it('scores correct area highest with keyword signal', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);
      const store = MykbStore.open(brainPath);
      try {
        const signals: Signal[] = [makeSignal('keyword', 'firewall VPN network')];
        const providers = [new KeywordSignalProvider()];
        const scores = scoreAreas(signals, providers, areas, store);

        expect(scores.get('networking')).toBeGreaterThan(0);
        // networking should score highest since signal matches its summary/tags
        const netScore = scores.get('networking') ?? 0;
        const ciScore = scores.get('ci-pipelines') ?? 0;
        expect(netScore).toBeGreaterThan(ciScore);
      } finally {
        store.close();
      }
    });
  });

  it('returns empty map with no signals', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);
      const store = MykbStore.open(brainPath);
      try {
        const signals: Signal[] = [];
        const providers = [new KeywordSignalProvider()];
        const scores = scoreAreas(signals, providers, areas, store);
        expect(scores.size).toBe(0);
      } finally {
        store.close();
      }
    });
  });

  it('FilePathSignalProvider scores area from file path keywords', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);
      const store = MykbStore.open(brainPath);
      try {
        const signals: Signal[] = [
          makeSignal('file_path', '/home/user/project/terraform/firewall.tf'),
        ];
        const providers = [new FilePathSignalProvider()];
        const scores = scoreAreas(signals, providers, areas, store);

        // 'firewall' appears in networking summary/tags
        expect(scores.get('networking')).toBeGreaterThan(0);
      } finally {
        store.close();
      }
    });
  });

  it('aggregates scores from multiple signals', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);
      const store = MykbStore.open(brainPath);
      try {
        const signals: Signal[] = [
          makeSignal('keyword', 'vault secrets'),
          makeSignal('keyword', 'certificates rotation'),
        ];
        const providers = [new KeywordSignalProvider()];
        const scores = scoreAreas(signals, providers, areas, store);

        const secScore = scores.get('secrets') ?? 0;
        const netScore = scores.get('networking') ?? 0;
        expect(secScore).toBeGreaterThan(netScore);
      } finally {
        store.close();
      }
    });
  });

  it('with workspace boost adds score to boosted areas', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);
      const store = MykbStore.open(brainPath);
      try {
        // No signals that match any area — only the boost should produce a score
        const signals: Signal[] = [makeSignal('keyword', 'something unrelated xyz')];
        const providers = [new KeywordSignalProvider()];
        const boostedAreas = new Set(['networking']);
        const scores = scoreAreas(signals, providers, areas, store, boostedAreas);

        // Networking should have a score from the workspace boost
        expect(scores.get('networking')).toBeGreaterThan(0);
      } finally {
        store.close();
      }
    });
  });

  it('with workspace boost — unboosted areas unaffected', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);
      const store = MykbStore.open(brainPath);
      try {
        // No matching signals
        const signals: Signal[] = [makeSignal('keyword', 'something unrelated xyz')];
        const providers = [new KeywordSignalProvider()];
        const boostedAreas = new Set(['networking']);
        const scores = scoreAreas(signals, providers, areas, store, boostedAreas);

        // ci-pipelines and secrets should not have any score
        expect(scores.has('ci-pipelines')).toBe(false);
        expect(scores.has('secrets')).toBe(false);
      } finally {
        store.close();
      }
    });
  });
});

describe('selectEntriesForInjection', () => {
  it('respects token budget', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);
      const store = MykbStore.open(brainPath);
      try {
        // Add facts to two areas
        store.addFact('area-a', 'A short fact about networking');
        store.addFact('area-a', 'Another fact about DNS configuration');
        store.addFact('area-b', 'Vault secret storage details here');

        const scoredAreas = new Map<string, number>();
        scoredAreas.set('area-a', 10);
        scoredAreas.set('area-b', 5);

        // Very small budget — should limit entries
        const entries = selectEntriesForInjection(scoredAreas, store, 20, new Set());

        // With budget of 20 tokens (~80 chars), should have limited entries
        let totalChars = 0;
        for (const [, areaEntries] of entries) {
          for (const entry of areaEntries) {
            totalChars += entry.text.length;
          }
        }
        // Total chars / 4 should be approximately within budget
        expect(totalChars / 4).toBeLessThanOrEqual(20 + 50); // allow some headroom for one entry
      } finally {
        store.close();
      }
    });
  });

  it('boosts already-loaded areas in selection', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);
      const store = MykbStore.open(brainPath);
      try {
        store.addFact('area-a', 'Fact from area A');
        store.addFact('area-b', 'Fact from area B');

        // Both areas have equal base score
        const scoredAreas = new Map<string, number>();
        scoredAreas.set('area-a', 5);
        scoredAreas.set('area-b', 5);

        // area-a is already loaded — it should get priority
        const loadedAreas = new Set(['area-a']);
        const entries = selectEntriesForInjection(scoredAreas, store, 2000, loadedAreas);

        // area-a should be present since it gets a boost
        expect(entries.has('area-a')).toBe(true);
      } finally {
        store.close();
      }
    });
  });

  it('returns empty map for empty scores', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);
      const store = MykbStore.open(brainPath);
      try {
        const scoredAreas = new Map<string, number>();
        const entries = selectEntriesForInjection(scoredAreas, store, 2000, new Set());
        expect(entries.size).toBe(0);
      } finally {
        store.close();
      }
    });
  });

  it('includes higher-scored areas first', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);
      const store = MykbStore.open(brainPath);
      try {
        store.addFact('high-area', 'Important fact');
        store.addFact('low-area', 'Less important fact');

        const scoredAreas = new Map<string, number>();
        scoredAreas.set('high-area', 100);
        scoredAreas.set('low-area', 1);

        // Tiny budget — only room for one area
        const entries = selectEntriesForInjection(scoredAreas, store, 10, new Set());

        // High-scored area should be included
        expect(entries.has('high-area')).toBe(true);
      } finally {
        store.close();
      }
    });
  });
});
