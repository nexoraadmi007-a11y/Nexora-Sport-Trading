import type { SignalCandidate } from '@nexora/types';
import { compareSignals } from '@nexora/utils';

export interface SignalAuditResult {
  approved: SignalCandidate[];
  rejected: Array<{ signal: SignalCandidate; reasons: string[] }>;
}

export class SignalEngine {
  audit(candidates: SignalCandidate[]): SignalAuditResult {
    const rejected: SignalAuditResult['rejected'] = [];
    const seen = new Set<string>();
    const approved: SignalCandidate[] = [];

    for (const signal of candidates.sort(compareSignals)) {
      const reasons = rejectionReasons(signal);
      const key = signalKey(signal);

      if (seen.has(key)) reasons.push('duplicate signal candidate');
      if (reasons.length > 0) {
        rejected.push({ signal, reasons });
        continue;
      }

      seen.add(key);
      approved.push({ ...signal, status: 'approved' });
    }

    return {
      approved: capDailyVolume(approved),
      rejected
    };
  }
}

function rejectionReasons(signal: SignalCandidate): string[] {
  const reasons: string[] = [];
  const minEv = Number(process.env.MIN_SIGNAL_EV || 0.025);
  const minConfidence = Number(process.env.MIN_SIGNAL_CONFIDENCE || 60);
  const minQuality = Number(process.env.MIN_SIGNAL_QUALITY || 68);

  if (!signal.fixture) reasons.push('missing fixture');
  if (!signal.bookmaker) reasons.push('missing bookmaker');
  if (!signal.odds || signal.odds <= 1) reasons.push('invalid odds');
  if (typeof signal.probability !== 'number') reasons.push('missing probability');
  if (typeof signal.ev !== 'number' || signal.ev < minEv) reasons.push(`EV below ${(minEv * 100).toFixed(1)}%`);
  if (typeof signal.confidence !== 'number' || signal.confidence < minConfidence) reasons.push(`confidence below ${minConfidence}`);
  if (typeof signal.qualityScore !== 'number' || signal.qualityScore < minQuality) reasons.push(`quality below ${minQuality}`);
  if (signal.riskLevel === 'HIGH') reasons.push('high risk');

  return reasons;
}

function capDailyVolume(signals: SignalCandidate[]): SignalCandidate[] {
  const maxDaily = Number(process.env.MAX_DAILY_SIGNALS || 5);
  const maxElitePerBatch = Number(process.env.MAX_ELITE_SIGNALS_PER_BATCH || 2);
  const selected: SignalCandidate[] = [];
  let eliteCount = 0;

  for (const signal of signals.sort(compareSignals)) {
    if (selected.length >= maxDaily) break;
    if (signal.tier === 'A+' && eliteCount >= maxElitePerBatch) continue;
    if (signal.tier === 'A+') eliteCount += 1;
    selected.push(signal);
  }

  return selected;
}

function signalKey(signal: SignalCandidate): string {
  return [
    signal.fixture?.id || 'fixture',
    signal.subject || '',
    signal.market,
    signal.selection
  ].join('|').toLowerCase();
}
