import type { SignalCandidate } from '@nexora/types';

export class SignalEngine {
  approve(candidates: SignalCandidate[]): SignalCandidate[] {
    const unique = new Map<string, SignalCandidate>();

    for (const candidate of candidates.filter((item) => item.ev > 0 && item.qualityScore >= 70)) {
      const key = candidate.fixture?.id || `${candidate.sport}:${candidate.market}:${candidate.selection}`;
      const current = unique.get(key);
      if (!current || candidate.qualityScore > current.qualityScore) {
        unique.set(key, candidate);
      }
    }

    return [...unique.values()]
      .sort((a, b) => b.qualityScore - a.qualityScore)
      .slice(0, Number(process.env.MAX_DAILY_SIGNALS || 5));
  }
}
