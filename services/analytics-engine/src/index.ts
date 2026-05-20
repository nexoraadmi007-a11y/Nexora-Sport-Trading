import type { SignalCandidate } from '@nexora/types';

export class AnalyticsEngine {
  summarize(signals: SignalCandidate[]) {
    return {
      count: signals.length,
      averageQuality: signals.length === 0
        ? 0
        : signals.reduce((sum, signal) => sum + signal.qualityScore, 0) / signals.length
    };
  }
}
