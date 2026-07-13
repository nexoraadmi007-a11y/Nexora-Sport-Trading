import type { SignalCandidate } from '@nexora/types';
import { compareSignals } from '@nexora/utils';

export class RiskEngine {
  removeCorrelatedExposure(signals: SignalCandidate[]): SignalCandidate[] {
    const maxPerFixture = Number(process.env.MAX_SIGNALS_PER_FIXTURE || 1);
    const fixtureCounts = new Map<string, number>();
    const engineCounts = new Map<string, number>();
    const selected: SignalCandidate[] = [];

    for (const signal of signals.sort(compareSignals)) {
      const fixtureId = signal.fixture?.id || `${signal.sport}:${signal.market}:${signal.selection}`;
      const fixtureCount = fixtureCounts.get(fixtureId) || 0;
      const engineCount = engineCounts.get(signal.engine) || 0;

      if (fixtureCount >= maxPerFixture) continue;
      if (!isUncappedBttsSignal(signal) && engineCount >= Number(process.env.MAX_SIGNALS_PER_ENGINE || 2)) continue;

      fixtureCounts.set(fixtureId, fixtureCount + 1);
      engineCounts.set(signal.engine, engineCount + 1);
      selected.push(signal);
    }

    return selected;
  }
}

function isUncappedBttsSignal(signal: SignalCandidate): boolean {
  return signal.engine.toLowerCase().includes('btts') && signal.market === 'BTTS';
}
