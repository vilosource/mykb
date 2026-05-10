import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { SessionState, sessionStatePath } from '../../src/extension/state.js';

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

  it('bumpTurnCount increments and is the persistence-aware variant', () => {
    const state = new SessionState();
    state.bumpTurnCount();
    state.bumpTurnCount();
    expect(state.turnCount).toBe(2);
  });
});

// --- Persistence path (file-backed across sessions) ---
//
// SessionState.create(sessionId) loads previously-persisted state for
// that id, and every mutation persists. Session-state files are
// scoped to a process-wide tmpdir and keyed by KB_SESSION_ID. These
// tests pin the cross-session continuity contract.

describe('SessionState persistence', () => {
  // Each test uses its own sessionId AND a fresh per-test brainPath so
  // concurrent test runs are fully isolated (and cleanup is automatic
  // via rmSync on the tmpdir).
  let sessionId: string;
  let brainPath: string;

  beforeEach(() => {
    sessionId = `test-${randomUUID()}`;
    brainPath = fs.mkdtempSync(path.join(os.tmpdir(), 'mykb-state-test-'));
  });

  afterEach(() => {
    fs.rmSync(brainPath, { recursive: true, force: true });
  });

  it('create() with no sessionId disables persistence', () => {
    const state = SessionState.create(undefined, brainPath);
    state.addSignal('keyword', 'frobnicator');
    expect(state.signals).toHaveLength(1);
    // The .sessions/ directory should not be created — persistence
    // only kicks in when both sessionId and brainPath are provided.
    expect(fs.existsSync(path.join(brainPath, '.sessions'))).toBe(false);
  });

  it('create() with sessionId but no brainPath disables persistence', () => {
    const state = SessionState.create(sessionId);
    state.addSignal('keyword', 'frobnicator');
    expect(state.signals).toHaveLength(1);
  });

  it('create() with both args persists addSignal across instances', () => {
    const a = SessionState.create(sessionId, brainPath);
    a.addSignal('keyword', 'frobnicator');

    const b = SessionState.create(sessionId, brainPath);
    expect(b.signals).toHaveLength(1);
    expect(b.signals[0].value).toBe('frobnicator');
  });

  it('persists clearSignals (file reflects empty)', () => {
    const a = SessionState.create(sessionId, brainPath);
    a.addSignal('keyword', 'frobnicator');
    a.clearSignals();

    const b = SessionState.create(sessionId, brainPath);
    expect(b.signals).toHaveLength(0);
  });

  it('persists loadedAreas, boostedAreas, turnCount across instances', () => {
    const a = SessionState.create(sessionId, brainPath);
    a.markAreaLoaded('frobnicators');
    a.setBoostedAreas(['hardware', 'specs']);
    a.bumpTurnCount();
    a.bumpTurnCount();

    const b = SessionState.create(sessionId, brainPath);
    expect(b.isAreaLoaded('frobnicators')).toBe(true);
    expect(Array.from(b.getBoostedAreas()).sort()).toEqual(['hardware', 'specs']);
    expect(b.turnCount).toBe(2);
  });

  it('different session ids do not see each other state', () => {
    const sessionB = `test-${randomUUID()}`;
    const a = SessionState.create(sessionId, brainPath);
    a.addSignal('keyword', 'frobnicator');

    const b = SessionState.create(sessionB, brainPath);
    expect(b.signals).toHaveLength(0);
  });

  it('different brainPaths do not see each other state', () => {
    const otherBrain = fs.mkdtempSync(path.join(os.tmpdir(), 'mykb-state-test-other-'));
    try {
      const a = SessionState.create(sessionId, brainPath);
      a.addSignal('keyword', 'frobnicator');

      const b = SessionState.create(sessionId, otherBrain);
      expect(b.signals).toHaveLength(0);
    } finally {
      fs.rmSync(otherBrain, { recursive: true, force: true });
    }
  });

  it('missing file is treated as fresh state, no errors', () => {
    const a = SessionState.create(sessionId, brainPath);
    expect(a.signals).toHaveLength(0);
    expect(a.turnCount).toBe(0);
    expect(a.isAreaLoaded('anything')).toBe(false);
  });

  it('creates .sessions/ directory on first write', () => {
    expect(fs.existsSync(path.join(brainPath, '.sessions'))).toBe(false);
    const a = SessionState.create(sessionId, brainPath);
    a.addSignal('keyword', 'frobnicator');
    expect(fs.existsSync(path.join(brainPath, '.sessions'))).toBe(true);
    const p = sessionStatePath(sessionId, brainPath)!;
    expect(fs.existsSync(p)).toBe(true);
  });

  it('malformed file is treated as fresh state', () => {
    const p = sessionStatePath(sessionId, brainPath)!;
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, 'this is not valid JSON');

    const a = SessionState.create(sessionId, brainPath);
    expect(a.signals).toHaveLength(0);
    expect(a.turnCount).toBe(0);

    // First write recovers the file to a valid snapshot.
    a.addSignal('keyword', 'recovered');
    const raw = fs.readFileSync(p, 'utf-8');
    expect(() => JSON.parse(raw)).not.toThrow();
    const snap = JSON.parse(raw);
    expect(snap.signals).toHaveLength(1);
  });

  it('partially-malformed snapshot fields are dropped, valid fields kept', () => {
    const p = sessionStatePath(sessionId, brainPath)!;
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(
      p,
      JSON.stringify({
        signals: [
          { type: 'keyword', value: 'good', timestamp: 123 },
          'not-a-signal-object',
          { type: 'incomplete' },
        ],
        loadedAreas: ['real-area', 42, null],
        boostedAreas: 'not-an-array',
        turnCount: 'not-a-number',
      }),
    );

    const a = SessionState.create(sessionId, brainPath);
    expect(a.signals).toHaveLength(1);
    expect(a.signals[0].value).toBe('good');
    expect(a.isAreaLoaded('real-area')).toBe(true);
    expect(a.boostedAreas.size).toBe(0);
    expect(a.turnCount).toBe(0);
  });

  it('sessionStatePath returns null when either arg is missing', () => {
    expect(sessionStatePath(null, brainPath)).toBeNull();
    expect(sessionStatePath(undefined, brainPath)).toBeNull();
    expect(sessionStatePath('', brainPath)).toBeNull();
    expect(sessionStatePath('   ', brainPath)).toBeNull();
    expect(sessionStatePath('valid-id', null)).toBeNull();
    expect(sessionStatePath('valid-id', undefined)).toBeNull();
  });

  it('sessionStatePath returns a brainPath-scoped file for valid args', () => {
    const p = sessionStatePath('abc123', brainPath);
    expect(p).not.toBeNull();
    expect(p).toBe(path.join(brainPath, '.sessions', 'abc123.json'));
  });
});
