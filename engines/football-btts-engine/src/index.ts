import type { EngineContext, MarketEngine, SignalCandidate } from '@nexora/types';

export class FootballBttsEngine implements MarketEngine {
  name = 'Football BTTS Engine Template';
  sport = 'football' as const;

  async generate(_context: EngineContext): Promise<SignalCandidate[]> {
    // TODO: Rebuild football BTTS logic on the clean infrastructure foundation.
    return [];
  }
}
