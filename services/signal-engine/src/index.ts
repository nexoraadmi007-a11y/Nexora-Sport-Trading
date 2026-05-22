import type { SignalCandidate } from '@nexora/types';

export class SignalEngine {
  approve(candidates: SignalCandidate[]): SignalCandidate[] {
    const unique = new Map<string, SignalCandidate>();

    for (const candidate of candidates.filter((item) => item.ev > 0 && item.qualityScore >= 70)) {
      const key = conflictKey(candidate);
      const current = unique.get(key);
      if (!current || candidate.qualityScore > current.qualityScore) {
        unique.set(key, candidate);
      }
    }

    return [...unique.values()]
      .sort((a, b) => b.qualityScore - a.qualityScore);
  }
}

function conflictKey(signal: SignalCandidate): string {
  const fixtureId = signal.fixture?.id || 'no-fixture';
  const subject = signal.subject || signal.selection;
  const market = signal.market.replace(/\b(Over|Under)\b/i, '').replace(/\s+/g, ' ').trim();
  return `${signal.sport}:${fixtureId}:${signal.engine}:${subject}:${market}`;
}
