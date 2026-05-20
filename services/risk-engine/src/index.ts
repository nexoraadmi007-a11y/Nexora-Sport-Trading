import type { SignalCandidate } from '@nexora/types';

export class RiskEngine {
  removeCorrelatedExposure(signals: SignalCandidate[]): SignalCandidate[] {
    const seenFixtures = new Set<string>();
    return signals.filter((signal) => {
      const id = signal.fixture?.id;
      if (!id) return true;
      if (seenFixtures.has(id)) return false;
      seenFixtures.add(id);
      return true;
    });
  }
}
