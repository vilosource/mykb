export type Signal = {
  type: string;
  value: string;
  timestamp: number;
};

export class SessionState {
  loadedAreas: Set<string> = new Set();
  turnCount: number = 0;
  signals: Signal[] = [];

  addSignal(type: string, value: string): void {
    this.signals.push({ type, value, timestamp: Date.now() });
  }

  clearSignals(): void {
    this.signals = [];
  }

  markAreaLoaded(area: string): void {
    this.loadedAreas.add(area);
  }

  isAreaLoaded(area: string): boolean {
    return this.loadedAreas.has(area);
  }
}
