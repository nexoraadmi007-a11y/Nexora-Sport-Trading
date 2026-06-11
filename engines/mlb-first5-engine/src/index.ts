import type { EngineContext, MarketEngine, SignalCandidate } from '@nexora/types';

export class MlbFirst5Engine implements MarketEngine {
  name = 'MLB First 5 Engine Template';
  sport = 'mlb' as const;

  async generate(_context: EngineContext): Promise<SignalCandidate[]> {
    // TODO: Rebuild MLB First 5 logic on the clean infrastructure foundation.
    return [];
  }
}
