import type { EngineContext, MarketEngine, SignalCandidate } from '@nexora/types';

export class FootballOver15Engine implements MarketEngine {
  name = 'Football Over 1.5 Engine Template';
  sport = 'football' as const;

  async generate(_context: EngineContext): Promise<SignalCandidate[]> {
    // TODO: Rebuild football Over 1.5 logic on the clean infrastructure foundation.
    return [];
  }
}
