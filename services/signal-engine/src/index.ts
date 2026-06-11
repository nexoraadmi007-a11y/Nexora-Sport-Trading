import type { SignalCandidate } from '@nexora/types';

export interface SignalAuditResult {
  approved: SignalCandidate[];
  rejected: Array<{ signal: SignalCandidate; reasons: string[] }>;
}

export class SignalEngine {
  audit(_candidates: SignalCandidate[]): SignalAuditResult {
    // TODO: Rebuild signal validation logic for the next NEXORA architecture.
    return {
      approved: [],
      rejected: []
    };
  }
}
