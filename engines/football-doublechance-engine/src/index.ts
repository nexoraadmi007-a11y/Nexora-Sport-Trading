import type { EngineContext, MarketEngine, SignalCandidate } from '@nexora/types';

export class FootballDoubleChanceEngine implements MarketEngine {
  name = 'Football Double Chance Engine Template';
  sport = 'football' as const;

  async generate(_context: EngineContext): Promise<SignalCandidate[]> {
    // TODO: Rebuild football Double Chance logic on the clean infrastructure foundation.
    return [];
  }
}
