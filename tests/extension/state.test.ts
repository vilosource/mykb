import { describe, it, expect } from 'vitest';
import { SessionState } from '../../src/extension/state.js';

describe('SessionState', () => {
  it('initializes with empty state', () => {
    const state = new SessionState();
    expect(state.loadedAreas.size).toBe(0);
    expect(state.turnCount).toBe(0);
    expect(state.signals).toHaveLength(0);
  });

  it('addSignal adds to signals array', () => {
    const state = new SessionState();
    state.addSignal('area-match', 'docker');
    expect(state.signals).toHaveLength(1);
    expect(state.signals[0].type).toBe('area-match');
    expect(state.signals[0].value).toBe('docker');
    expect(typeof state.signals[0].timestamp).toBe('number');
  });

  it('addSignal accumulates multiple signals', () => {
    const state = new SessionState();
    state.addSignal('area-match', 'docker');
    state.addSignal('keyword', 'terraform');
    expect(state.signals).toHaveLength(2);
  });

  it('clearSignals empties the array', () => {
    const state = new SessionState();
    state.addSignal('area-match', 'docker');
    state.addSignal('keyword', 'terraform');
    state.clearSignals();
    expect(state.signals).toHaveLength(0);
  });

  it('markAreaLoaded tracks loaded areas', () => {
    const state = new SessionState();
    expect(state.isAreaLoaded('docker')).toBe(false);
    state.markAreaLoaded('docker');
    expect(state.isAreaLoaded('docker')).toBe(true);
  });

  it('isAreaLoaded returns false for unloaded areas', () => {
    const state = new SessionState();
    state.markAreaLoaded('docker');
    expect(state.isAreaLoaded('terraform')).toBe(false);
  });

  it('turnCount can be incremented', () => {
    const state = new SessionState();
    state.turnCount++;
    expect(state.turnCount).toBe(1);
    state.turnCount++;
    expect(state.turnCount).toBe(2);
  });
});
