import type { SignalCandidate } from '@nexora/types';

export interface SignalAuditResult {
  approved: SignalCandidate[];
  rejected: Array<{
    signal: SignalCandidate;
    reasons: string[];
  }>;
}

export class SignalEngine {
  approve(candidates: SignalCandidate[]): SignalCandidate[] {
    return this.audit(candidates).approved;
  }

  audit(candidates: SignalCandidate[]): SignalAuditResult {
    const unique = new Map<string, SignalCandidate>();
    const rejected: SignalAuditResult['rejected'] = [];

    for (const candidate of candidates) {
      const reasons = falsePositiveReasons(candidate);
      if (reasons.length > 0) {
        rejected.push({ signal: candidate, reasons });
        continue;
      }

      const key = conflictKey(candidate);
      const current = unique.get(key);
      if (!current || candidate.qualityScore > current.qualityScore) {
        if (current) rejected.push({ signal: current, reasons: ['lower-ranked duplicate/correlated candidate'] });
        unique.set(key, candidate);
      } else {
        rejected.push({ signal: candidate, reasons: ['lower-ranked duplicate/correlated candidate'] });
      }
    }

    return {
      approved: [...unique.values()]
        .sort((a, b) => b.qualityScore - a.qualityScore),
      rejected
    };
  }
}

function conflictKey(signal: SignalCandidate): string {
  const fixtureId = signal.fixture?.id || 'no-fixture';
  const subject = signal.subject || 'match';
  return `${signal.sport}:${fixtureId}:${subject}`;
}

function falsePositiveReasons(signal: SignalCandidate): string[] {
  const reasons: string[] = [];
  const confidence = normalizedConfidence(signal.confidence);
  const minimumQuality = Number(process.env.MIN_SIGNAL_QUALITY || 78);
  const minimumEv = Number(process.env.MIN_SIGNAL_EV || 0.03);
  const minimumConfidence = Number(process.env.MIN_SIGNAL_CONFIDENCE || 72);

  if (!signal.fixture) reasons.push('missing fixture context');
  if (!signal.bookmaker) reasons.push('missing bookmaker confirmation');
  if (!Number.isFinite(signal.odds) || signal.odds <= 1) reasons.push('corrupt odds');
  if (signal.odds < minOddsFor(signal) || signal.odds > maxOddsFor(signal)) reasons.push('odds outside disciplined range');
  if (!Number.isFinite(signal.trueProbability) || signal.trueProbability <= 0 || signal.trueProbability >= 0.95) reasons.push('unrealistic probability');
  if (!Number.isFinite(signal.ev) || signal.ev < minimumEv) reasons.push('weak EV validation');
  if (!Number.isFinite(confidence) || confidence < minimumConfidence) reasons.push('confidence below desk threshold');
  if (!Number.isFinite(signal.qualityScore) || signal.qualityScore < minimumQuality) reasons.push('quality score below desk threshold');
  if (signal.tier === 'B' && process.env.ALLOW_TIER_B_SIGNALS !== 'true') reasons.push('Tier B blocked by elite-only mode');
  if (isMarketProxy(signal) && process.env.ALLOW_PROXY_MARKETS !== 'true') reasons.push('proxy market blocked');
  if (isStaleFixture(signal)) reasons.push('fixture already started or stale');

  return reasons;
}

function normalizedConfidence(confidence: number): number {
  return confidence <= 10 ? confidence * 10 : confidence;
}

function minOddsFor(signal: SignalCandidate): number {
  if (signal.engine.includes('Double Chance')) return 1.2;
  if (signal.sport === 'football') return 1.35;
  return 1.55;
}

function maxOddsFor(signal: SignalCandidate): number {
  if (signal.engine.includes('Double Chance')) return 1.75;
  if (signal.engine.includes('Player Props')) return 2.2;
  if (signal.sport === 'nba') return 2.1;
  return 2.15;
}

function isMarketProxy(signal: SignalCandidate): boolean {
  return /\bproxy\b/i.test(signal.market);
}

function isStaleFixture(signal: SignalCandidate): boolean {
  if (!signal.fixture) return true;
  return signal.fixture.startsAt.getTime() <= Date.now();
}
