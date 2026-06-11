import type { EngineContext, MarketEngine, SignalCandidate } from '@nexora/types';

export class NbaFirstHalfEngine implements MarketEngine {
  name = 'NBA First Half Engine Template';
  sport = 'nba' as const;

  async generate(_context: EngineContext): Promise<SignalCandidate[]> {
    // TODO: Rebuild NBA first-half logic on the clean infrastructure foundation.
    return [];
  }
}
