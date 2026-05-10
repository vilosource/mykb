import fs from 'node:fs';
import path from 'node:path';

export type Signal = {
  type: string;
  value: string;
  timestamp: number;
};

/**
 * Serializable snapshot of SessionState. The on-disk format we persist
 * to (and read back from) when a stable KB_SESSION_ID is set in the
 * environment. JSON-only, no class wrappers — keep the format trivially
 * version-tolerant.
 */
type SessionStateSnapshot = {
  signals: Signal[];
  loadedAreas: string[];
  boostedAreas: string[];
  turnCount: number;
};

/**
 * Path where SessionState is persisted for a given (brainPath, sessionId)
 * pair. The file lives under the brain directory (not os.tmpdir()) so it
 * is reachable across separate Pi container invocations: the brain is
 * bind-mounted into each container, so a host-side write from one
 * container is visible to the next. A container-local tmpdir would be
 * destroyed at container exit and lose the persistence we want.
 *
 * Returns null when either argument is missing — persistence is opt-in,
 * keyed by KB_SESSION_ID. Sessions without an id stay in-memory-only
 * (backward-compatible default).
 */
export function sessionStatePath(
  sessionId: string | null | undefined,
  brainPath: string | null | undefined,
): string | null {
  const id = sessionId?.trim();
  if (!id) return null;
  if (!brainPath) return null;
  return path.join(brainPath, '.sessions', `${id}.json`);
}

export class SessionState {
  loadedAreas: Set<string> = new Set();
  boostedAreas: Set<string> = new Set();
  turnCount: number = 0;
  signals: Signal[] = [];

  // Persistence file path, or null when persistence is disabled.
  // Set via SessionState.create() with a session id + brainPath;
  // mutators call _persist() after each change so the file is current.
  private persistPath: string | null = null;

  /**
   * Construct a SessionState, optionally loading previously-persisted
   * state for a given (sessionId, brainPath) pair.
   *
   * - both set + file exists: load fields from file.
   * - both set + file missing: fresh state; subsequent mutations create.
   * - either unset: fresh state, persistence disabled (in-memory only —
   *   backward-compatible default).
   */
  static create(sessionId?: string | null, brainPath?: string | null): SessionState {
    const state = new SessionState();
    state.persistPath = sessionStatePath(sessionId, brainPath);
    if (state.persistPath && fs.existsSync(state.persistPath)) {
      try {
        const raw = fs.readFileSync(state.persistPath, 'utf-8');
        const snap = JSON.parse(raw) as Partial<SessionStateSnapshot>;
        if (Array.isArray(snap.signals)) {
          // Defensive: only accept entries that look like Signals.
          state.signals = snap.signals.filter(
            (s): s is Signal =>
              s !== null &&
              typeof s === 'object' &&
              typeof (s as Signal).type === 'string' &&
              typeof (s as Signal).value === 'string' &&
              typeof (s as Signal).timestamp === 'number',
          );
        }
        if (Array.isArray(snap.loadedAreas)) {
          state.loadedAreas = new Set(snap.loadedAreas.filter((a) => typeof a === 'string'));
        }
        if (Array.isArray(snap.boostedAreas)) {
          state.boostedAreas = new Set(snap.boostedAreas.filter((a) => typeof a === 'string'));
        }
        if (typeof snap.turnCount === 'number' && Number.isFinite(snap.turnCount)) {
          state.turnCount = snap.turnCount;
        }
      } catch {
        // Malformed file → silently treat as fresh state. The next
        // mutation will overwrite with a valid snapshot. We don't want
        // a corrupted state file to crash the session.
      }
    }
    return state;
  }

  /**
   * Persist the current state to disk if a sessionId/brainPath were set.
   * No-op otherwise. Called automatically by every mutator.
   *
   * Errors are swallowed: persistence is best-effort. A read-only
   * filesystem or full disk should not crash a session — the in-memory
   * state remains correct.
   */
  private _persist(): void {
    if (!this.persistPath) return;
    const snap: SessionStateSnapshot = {
      signals: this.signals,
      loadedAreas: Array.from(this.loadedAreas),
      boostedAreas: Array.from(this.boostedAreas),
      turnCount: this.turnCount,
    };
    try {
      const dir = path.dirname(this.persistPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.persistPath, JSON.stringify(snap));
    } catch {
      // best-effort; see comment above.
    }
  }

  addSignal(type: string, value: string): void {
    this.signals.push({ type, value, timestamp: Date.now() });
    this._persist();
  }

  clearSignals(): void {
    this.signals = [];
    this._persist();
  }

  markAreaLoaded(area: string): void {
    this.loadedAreas.add(area);
    this._persist();
  }

  isAreaLoaded(area: string): boolean {
    return this.loadedAreas.has(area);
  }

  setBoostedAreas(areas: string[]): void {
    this.boostedAreas = new Set(areas);
    this._persist();
  }

  getBoostedAreas(): Set<string> {
    return this.boostedAreas;
  }

  /**
   * Increment turnCount and persist. The context hook needs to bump
   * the counter after each scoring pass; previously this was a direct
   * field mutation, which bypassed persistence. Callers should prefer
   * this method over `state.turnCount++`.
   */
  bumpTurnCount(): void {
    this.turnCount++;
    this._persist();
  }
}
