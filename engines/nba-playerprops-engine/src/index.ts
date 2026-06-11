import type { EngineContext, MarketEngine, SignalCandidate } from '@nexora/types';

export class NbaPlayerPropsEngine implements MarketEngine {
  name = 'NBA Player Props Engine Template';
  sport = 'nba' as const;

  async generate(_context: EngineContext): Promise<SignalCandidate[]> {
    // TODO: Rebuild NBA player props logic on the clean infrastructure foundation.
    return [];
  }
}
