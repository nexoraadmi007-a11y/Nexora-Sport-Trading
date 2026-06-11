import type { EngineContext, MarketEngine, SignalCandidate } from '@nexora/types';

export class TennisHardcourtOverGamesEngine implements MarketEngine {
  name = 'Tennis Hardcourt Over Games Engine Template';
  sport = 'tennis' as const;

  async generate(_context: EngineContext): Promise<SignalCandidate[]> {
    // TODO: Rebuild tennis hardcourt over-games logic on the clean infrastructure foundation.
    return [];
  }
}
