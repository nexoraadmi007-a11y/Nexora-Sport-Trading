import type { SignalCandidate } from '@nexora/types';

export class RiskEngine {
  removeCorrelatedExposure(signals: SignalCandidate[]): SignalCandidate[] {
    const seenConflicts = new Set<string>();
    return signals.filter((signal) => {
      const key = conflictKey(signal);
      if (seenConflicts.has(key)) return false;
      seenConflicts.add(key);
      return true;
    });
  }
}

function conflictKey(signal: SignalCandidate): string {
  const fixtureId = signal.fixture?.id || 'no-fixture';
  const subject = signal.subject || signal.selection;
  const market = signal.market.replace(/\b(Over|Under)\b/i, '').replace(/\s+/g, ' ').trim();
  return `${signal.sport}:${fixtureId}:${signal.engine}:${subject}:${market}`;
}
