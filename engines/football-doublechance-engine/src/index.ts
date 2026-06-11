import type { EngineContext, MarketEngine, SignalCandidate } from '@nexora/types';
import { buildConsensusSignals } from '@nexora/utils';

export class FootballDoubleChanceEngine implements MarketEngine {
  name = 'Football Double Chance Specialist';
  sport = 'football' as const;

  async generate(context: EngineContext): Promise<SignalCandidate[]> {
    return buildConsensusSignals(context, {
      sport: this.sport,
      engine: this.name,
      marketLabel: 'Double Chance',
      marketFilter: (price) => price.market === 'Double Chance',
      minOdds: 1.2,
      maxOdds: 1.9,
      minBookmakers: 2,
      minEv: 0.02,
      minConfidence: 64,
      minQuality: 70,
      reason: (fixture, _price, stats) => [
        'Double Chance stability profile',
        `${stats.bookmakerCount} bookmaker prices`,
        `${fixture.competition?.kind || 'club'} weighting`,
        `low variance score ${Math.round(stats.stability)}/100`
      ].join(' + ')
    });
  }
}
